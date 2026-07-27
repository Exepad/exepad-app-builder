from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models.llm_response import LlmResponse
from google.adk.planners import BuiltInPlanner
from google.genai import types
from datetime import datetime
from dotenv import load_dotenv
from typing import Optional
from pydantic import BaseModel, Field
import re
import structlog
from config import get_agent_model, AgentName
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder

load_dotenv()

logger = structlog.get_logger(__name__)


# output schema - optimized with optional summary
class ConversationMessageSummary(BaseModel):
    """Optional summary of the conversation."""

    user_ask: str = Field(default="", description="Brief summary of user request")
    assistant_action_and_response: str = Field(
        default="", description="Brief summary of actions taken"
    )


class ChatResponseWriterOutput(BaseModel):
    """Defines the output structure for the ChatResponseWriterAgent."""

    result_chat_response: str = Field(description="The chat response to the user.")
    conversation_message_summary: Optional[ConversationMessageSummary] = Field(
        default=None, description="Optional conversation summary"
    )


def _strip_code_fence(text: str) -> str:
    """Drop a wrapping ```/```lang fence (multi- OR single-line) and return the
    inner content — models sometimes fence their JSON.

    Handles both ``` ```json\n{...}\n``` ``` and the single-line
    ``` ```json {...}``` ``` shape. Crucially the single-line case must NOT nuke
    the payload (the old ``split("\\n")`` returned "" when there was no newline,
    which then shipped an empty message)."""
    s = text.strip()
    if not s.startswith("```"):
        return s
    inner = s[3:]  # drop the opening ```
    newline = inner.find("\n")
    if newline != -1:
        # Multi-line: the first line is the optional language tag (```json) — drop it.
        inner = inner[newline + 1 :]
    else:
        # Single line: drop an optional leading language token (json / ts / …).
        inner = re.sub(r"^[A-Za-z0-9_+-]*\s*", "", inner, count=1)
    inner = inner.rstrip()
    if inner.endswith("```"):
        inner = inner[:-3]
    return inner.strip()


def _coerce_plaintext_response(
    callback_context: CallbackContext,
    llm_response: LlmResponse,
) -> Optional[LlmResponse]:
    """Make the final chat-message step robust to weak-model output.

    A weak / non-Gemini model routinely emits the response as PLAIN TEXT (or a
    fenced JSON block) instead of the bare ``ChatResponseWriterOutput`` JSON, so
    ADK's ``output_schema`` parse (``validate_schema`` → ``model_validate_json``)
    raises ``ValidationError`` and the whole turn is re-rolled — burning a retry
    and (before the log fix) dumping a multi-thousand-line traceback. The prose
    the model wrote IS the message, so wrap it as
    ``{"result_chat_response": <text>}`` and let ADK parse cleanly on attempt 1.

    Conservative: a response that already parses as valid JSON is left untouched,
    and a JSON-shaped-but-invalid response (truncated / malformed) is left for
    the retry service to re-roll rather than being mis-wrapped as prose.
    """
    content = getattr(llm_response, "content", None)
    if content is None or not getattr(content, "parts", None):
        return None
    text = "".join(
        p.text
        for p in content.parts
        if getattr(p, "text", None) and not getattr(p, "thought", False)
    )
    stripped = text.strip()
    if not stripped:
        return None
    # 1) Already valid schema JSON → leave it.
    try:
        ChatResponseWriterOutput.model_validate_json(stripped)
        return None
    except Exception:
        pass
    # 2) Fenced JSON → rewrite to the bare JSON so ADK parses it.
    unfenced = _strip_code_fence(stripped)
    if unfenced != stripped:
        try:
            ChatResponseWriterOutput.model_validate_json(unfenced)
            content.parts = [types.Part(text=unfenced)]
            return llm_response
        except Exception:
            pass
    # 2b) Fence-stripping left nothing usable (a bare/truncated ``` fence). Do
    #     NOT wrap "" — that ships the literal {"result_chat_response": ""} to the
    #     user. Leave it for the retry service to re-roll, as before this fix.
    if not unfenced.strip():
        return None
    # 3) JSON-shaped but invalid (truncated / malformed) → let the retry re-roll;
    #    mis-wrapping a partial JSON blob as the user-visible message is worse.
    if unfenced[:1] in ("{", "["):
        return None
    # 4) Genuine prose → the text the model wrote is the chat response.
    wrapped = ChatResponseWriterOutput(result_chat_response=unfenced).model_dump_json()
    content.parts = [types.Part(text=wrapped)]
    logger.info("chat_response_writer_coerced_plaintext", chars=len(unfenced))
    return llm_response


def chat_response_writer_instruction_provider(context: ReadonlyContext) -> str:
    """Instruction provider for ChatResponseWriterAgent.

    Prompt order is deliberate for prefix caching: static_intro + safety doc
    form a byte-stable prefix; only the date+input tail varies per call.
    """
    result_response_writer_prompt = context.session.state.get("result_response_writer_prompt", "")

    static_intro = """You are Exepad, an AI assistant that helps the user build their web app.

## Task
Write a friendly 1-3 sentence response (max 100 words) summarizing what was done.
Optionally extract: user_ask (what user wanted), assistant_action_and_response (what was done).

## Rules
- Match user's language from the request
- Friendly, non-technical tone for business users
- No next steps, no emojis, no markdown

## Grounding (NON-NEGOTIABLE)
- Describe ONLY what is in the Input. If the Input lists specific models or
  pages, you may name them. If the Input does NOT name a specific feature,
  do NOT invent one.
- Forbidden embellishments when the Input does not explicitly support them:
  "fully configured backend", "integrated mapping", "dynamic backend",
  "powerful integrations", "seamless workflow", "enterprise-grade", "robust",
  "feature-rich". These are vague claims that misrepresent the build.
- If the build only set up auto-CRUD on a few models (no custom handlers,
  no maps, no payments, no email), describe it plainly: "a {N}-page site
  with a {model_name} table you can edit from the dashboard". Do not
  upgrade auto-CRUD into "fully configured backend".
"""

    dynamic_tail = (
        f"\n## Date\n{datetime.now().strftime('%Y-%m-%d')}\n\n"
        f"## Input\n{result_response_writer_prompt}"
    )

    return (
        InstructionBuilder()
        .add(static_intro)
        .add_doc("common/docs/00_REFUSAL_RULES.md")
        .add(dynamic_tail)
        .build()
    )


# agent definition
result_response_writer_agent = LlmAgent(
    name=AgentName.RESULT_RESPONSE_WRITER,
    model=get_agent_model(AgentName.RESULT_RESPONSE_WRITER),
    description="Exepad App Creation platform's friendly agent that summarizes results and answers Exepad questions for non-technical users.",
    instruction=chat_response_writer_instruction_provider,
    input_schema=None,
    output_schema=ChatResponseWriterOutput,
    output_key="result_chat_response",
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
    # Coerce a plain-text / fenced response into schema JSON so a weak model's
    # most common failure doesn't burn a retry (or crash the final message step).
    after_model_callback=_coerce_plaintext_response,
)

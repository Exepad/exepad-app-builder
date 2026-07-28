# Agent Input/Output Schema Analysis & Rubric Recommendations

## 1. ResultResponseWriterAgent

**Location:** `main_agent/agents/orchestrator/app_types/shared/subagents/chat_response_writer.py`

### Input Schema Fields

**Input Schema:** `None` (agent uses context from session state)
- Agent reads from `context.session.state.get("result_response_writer_prompt", "")`
- Expected prompt format includes:
  - User request summary
  - Workflow type (creation/edit/help_desk)
  - Tasks completed
  - Language preference

### Output Schema Fields

**ChatResponseWriterOutput:**
- `result_chat_response` (str): The chat response to the user (1-3 sentences, max 100 words)
- `conversation_message_summary` (Optional[ConversationMessageSummary]): Optional summary
  - `user_ask` (str): Brief summary of user request
  - `assistant_action_and_response` (str): Brief summary of actions taken

### Key Behaviors That Should Be Tested

1. **Response Length**: Generates concise 1-3 sentence responses (max 100 words)
2. **Language Matching**: Matches user's language from the request
3. **Tone Appropriateness**: Uses friendly, non-technical tone suitable for business users
4. **Content Accuracy**: Accurately summarizes what was done based on tasks completed
5. **Workflow Awareness**: Adapts response style based on workflow type
6. **No Markdown/Emojis**: Avoids markdown formatting and emojis
7. **No Next Steps**: Does not include next steps or suggestions
8. **Optional Summary**: May include conversation summary with user_ask and assistant_action_and_response
9. **Multilingual Support**: Handles multiple languages correctly

### Rubrics to Verify Correct Behavior

1. **Response Length Compliance** (Critical)
   - **Criterion**: Response is 1-3 sentences, max 100 words
   - **Scoring**: Binary (within limits) or numeric (word count)

2. **Language Matching** (High Priority)
   - **Criterion**: Response language matches user's request language
   - **Scoring**: Binary (language matches) or language detection score

3. **Tone Appropriateness** (High Priority)
   - **Criterion**: Friendly, non-technical tone suitable for business users
   - **Scoring**: LLM-as-judge rubric (0-1 score)

4. **Content Accuracy** (Critical)
   - **Criterion**: Accurately summarizes tasks completed
   - **Scoring**: LLM-as-judge rubric comparing response to tasks completed

5. **Format Compliance** (Critical)
   - **Criterion**: No markdown, no emojis, no next steps
   - **Scoring**: Binary (complies/doesn't comply)

6. **Output Schema Compliance** (Critical)
   - **Criterion**: Output strictly conforms to `ChatResponseWriterOutput` schema
   - **Scoring**: Binary (valid/invalid schema)

---

## Summary of Rubric Priorities

### ResultResponseWriterAgent
- **Critical**: Response length, content accuracy, format compliance, schema compliance
- **High**: Language matching, tone appropriateness
- **Medium**: Workflow adaptation, edge case handling
- **Low**: Summary quality (optional)

## Recommended Evaluation Approach

1. **Automated Schema Validation**: Binary pass/fail for schema compliance
2. **Semantic Evaluation**: Use LLM-as-judge for semantic correctness
3. **Rule-Based Checks**: Deterministic checks for structural requirements (length limits)
4. **Multi-Language Testing**: Especially important for ResultResponseWriterAgent

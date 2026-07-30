#!/usr/bin/env python3
"""
CLI tool for testing the Exepad Agent locally.

This script allows you to interact with the agent from the command line,
making it easy to test different operation modes and payloads.
"""

import os
import sys
import json
import time
import asyncio
import argparse
import logging
from typing import Dict, Any, Optional, TextIO
from pathlib import Path
from datetime import datetime

# Add the parent directory to the path for imports
sys.path.insert(0, str(Path(__file__).parent))

# Configuration - load early before heavy imports
from dotenv import load_dotenv
load_dotenv()
load_dotenv('.env.local', override=True)

AGENT_APP_NAME = os.getenv("AGENT_APP_NAME", "exepad_agent")
SESSION_SERVICE_URI = os.getenv("SESSION_SERVICE_URI")


class FileStreamHandler(logging.Handler):
    """Custom logging handler that writes to an open file stream."""

    def __init__(self, file_stream):
        super().__init__()
        self.file_stream = file_stream

    def emit(self, record):
        try:
            msg = self.format(record)
            self.file_stream.write(msg + "\n")
            self.file_stream.flush()
        except Exception:
            self.handleError(record)


class TeeStream:
    """Stream that writes to both original stream and a file."""

    def __init__(self, original_stream, file_stream):
        self.original_stream = original_stream
        self.file_stream = file_stream

    def write(self, data):
        # Write to original stream (console)
        self.original_stream.write(data)
        self.original_stream.flush()
        # Also write to file
        self.file_stream.write(data)
        self.file_stream.flush()

    def flush(self):
        self.original_stream.flush()
        self.file_stream.flush()

    def isatty(self):
        return self.original_stream.isatty()

    def fileno(self):
        return self.original_stream.fileno()


class LogWriter:
    """Handles writing output to both console and log file."""

    def __init__(self, log_file_path: Optional[str] = None, enable_file_logging: bool = True, log_level: str = "INFO"):
        """
        Initialize the log writer.

        Args:
            log_file_path: Path to the log file. If None, auto-generates timestamped file.
            enable_file_logging: Whether to enable file logging.
            log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
        """
        self.enable_file_logging = enable_file_logging
        self.log_file: Optional[TextIO] = None
        self.log_file_path: Optional[str] = None
        self.raw_responses = []
        self.start_time = time.time()
        self.log_level = log_level
        self.file_handler = None
        self.original_stderr = None
        self.tee_stderr = None

        if enable_file_logging:
            # Create logs directory if it doesn't exist
            logs_dir = Path("logs")
            logs_dir.mkdir(exist_ok=True)

            # Generate log file path if not provided
            if log_file_path is None:
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                self.log_file_path = str(logs_dir / f"agent_run_{timestamp}.log")
            else:
                self.log_file_path = log_file_path

            # Open log file
            try:
                self.log_file = open(self.log_file_path, 'w', encoding='utf-8')
                print(f"📝 Logging to: {self.log_file_path}")
                print(f"📊 Log level: {log_level}")
            except Exception as e:
                print(f"⚠ Warning: Could not open log file: {e}")
                self.enable_file_logging = False

    def write(self, message: str, to_file_only: bool = False):
        """
        Write message to console and/or file.

        Args:
            message: The message to write
            to_file_only: If True, only write to file (not console)
        """
        if not to_file_only:
            print(message)

        if self.enable_file_logging and self.log_file:
            self.log_file.write(message + "\n")
            self.log_file.flush()

    def setup_logging(self):
        """Set up Python logging and capture stderr (for structlog) to file."""
        if not self.enable_file_logging or not self.log_file:
            return

        # Write section header first
        self.write("\n" + "="*70, to_file_only=True)
        self.write("SYSTEM LOGS (Full Logger Output)", to_file_only=True)
        self.write("="*70 + "\n", to_file_only=True)

        # Create a custom file stream handler that uses our existing file handle
        self.file_handler = FileStreamHandler(self.log_file)

        # Set log level
        level = getattr(logging, self.log_level.upper(), logging.INFO)
        self.file_handler.setLevel(level)

        # Create a formatter that matches structlog output format
        formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] %(name)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        self.file_handler.setFormatter(formatter)

        # Add the handler to the root logger (captures standard Python logging)
        root_logger = logging.getLogger()
        root_logger.setLevel(level)
        root_logger.addHandler(self.file_handler)

        # Capture stderr to also write structlog output to file
        # structlog typically writes to stderr, so we intercept it
        self.original_stderr = sys.stderr
        self.tee_stderr = TeeStream(self.original_stderr, self.log_file)
        sys.stderr = self.tee_stderr

    def write_header(self, operation_mode: str, user_id: str, session_id: str, payload: Dict[str, Any]):
        """Write the log file header."""
        header = f"""{'='*70}
Agent Run Log
{'='*70}
Timestamp: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
Operation Mode: {operation_mode}
User ID: {user_id}
Session ID: {session_id}
Payload:
{json.dumps(payload, indent=2)}
Log Level: {self.log_level}
{'='*70}

"""
        self.write(header, to_file_only=True)

        # Set up logging to capture system logs
        self.setup_logging()

    def log_response(self, response_data: Dict[str, Any], response_number: int):
        """Log raw response data."""
        self.raw_responses.append(response_data)
        timestamp = datetime.now().strftime("%H:%M:%S")

        self.write(
            f"\n--- Raw Response {response_number} [{timestamp}] ---",
            to_file_only=True
        )
        self.write(
            json.dumps(response_data, indent=2),
            to_file_only=True
        )
        self.write("", to_file_only=True)

    def write_summary(self, response_count: int, status: str = "Completed"):
        """Write the log file summary."""
        duration = time.time() - self.start_time
        summary = f"""
{'='*70}
Run Summary
{'='*70}
Total Responses: {response_count}
Duration: {duration:.2f}s
Status: {status}
Timestamp: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
{'='*70}
"""
        self.write(summary, to_file_only=True)

    def write_agent_responses_header(self):
        """Write header for agent responses section."""
        header = f"""
{'='*70}
AGENT RESPONSES (Formatted Output)
{'='*70}
"""
        self.write(header, to_file_only=True)

    def close(self):
        """Close the log file and restore stderr."""
        # Restore original stderr
        if self.original_stderr:
            sys.stderr = self.original_stderr

        if self.file_handler:
            # Remove the handler from the root logger
            root_logger = logging.getLogger()
            root_logger.removeHandler(self.file_handler)
            self.file_handler.close()

        if self.log_file:
            self.log_file.close()
            if self.enable_file_logging:
                print(f"\n📄 Log file saved: {self.log_file_path}")


class AgentCLI:
    """Command-line interface for testing the agent."""

    def __init__(self, session_uri: Optional[str] = None):
        """
        Initialize the CLI with session service.

        Args:
            session_uri: Optional database session URI
        """
        self.session_uri = session_uri or SESSION_SERVICE_URI
        self.runner = None
        self.session_service = None

    def _initialize_agent(self):
        """Initialize the agent and runner. Called after logging is set up."""
        # Import heavy dependencies only when needed
        from google.adk.runners import Runner
        from google.adk.sessions import DatabaseSessionService
        from google.adk.artifacts import InMemoryArtifactService
        from main_agent.agent import root_agent

        if self.session_uri:
            self.session_service = DatabaseSessionService(db_url=self.session_uri)
            print(f"✓ Using database session service: {self.session_uri}")
        else:
            print("⚠ Warning: No SESSION_SERVICE_URI set. Using in-memory sessions.")
            self.session_service = None

        # Initialize artifact service (in-memory; the cloud GCS-backed store was removed)
        self.artifact_service = InMemoryArtifactService()

        self.runner = Runner(
            agent=root_agent,
            app_name=AGENT_APP_NAME,
            session_service=self.session_service,
            artifact_service=self.artifact_service,
        )

    async def run_agent(
        self,
        operation_mode: str,
        payload: Dict[str, Any],
        user_id: str = "test_user",
        session_id: Optional[str] = None,
        log_file_path: Optional[str] = None,
        enable_file_logging: bool = True,
        log_level: str = "INFO"
    ):
        """
        Run the agent with the specified parameters.

        Args:
            operation_mode: The operation mode (e.g., 'create', 'edit', 'blog')
            payload: The payload data as a dictionary
            user_id: The user ID for the session
            session_id: Optional session ID (will be generated if not provided)
            log_file_path: Optional path for log file
            enable_file_logging: Whether to enable file logging
            log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
        """
        # Import Google types
        from google.genai.types import Content, Part
        from google.adk.events import Event, EventActions

        # Generate session ID if not provided
        if not session_id:
            import uuid
            session_id = str(uuid.uuid4())

        # Initialize log writer
        log_writer = LogWriter(log_file_path=log_file_path, enable_file_logging=enable_file_logging, log_level=log_level)

        log_writer.write(f"\n{'='*60}")
        log_writer.write(f"🚀 Starting Agent Run")
        log_writer.write(f"{'='*60}")
        log_writer.write(f"Operation Mode: {operation_mode}")
        log_writer.write(f"User ID: {user_id}")
        log_writer.write(f"Session ID: {session_id}")
        log_writer.write(f"Payload: {json.dumps(payload, indent=2)}")
        log_writer.write(f"{'='*60}\n")

        # Write detailed header to log file (this sets up logging and redirects stderr)
        log_writer.write_header(operation_mode, user_id, session_id, payload)

        # NOW initialize the agent (after stderr redirection is set up)
        # This ensures structlog gets configured with our redirected stderr
        if self.runner is None:
            self._initialize_agent()

        # Create session
        session = await self.runner.session_service.create_session(
            app_name=AGENT_APP_NAME,
            user_id=user_id,
            session_id=session_id
        )

        # Prepare state delta
        state_delta = {
            "operation_mode": operation_mode,
            **payload
        }

        # Push state to session
        system_event = Event(
            author="CLI_Runner",
            actions=EventActions(state_delta=state_delta),
            timestamp=time.time(),
        )
        await self.runner.session_service.append_event(session, system_event)

        log_writer.write("📡 Agent is processing...\n")

        # Run agent and collect responses
        response_count = 0
        status = "Completed"
        agent_responses_header_written = False
        try:
            async for event in self.runner.run_async(
                user_id=session.user_id,
                session_id=session.id,
                new_message=Content(role="user", parts=[Part(text="")]),
            ):
                try:
                    # Check if event has valid content structure
                    if (event.content and
                        event.content.parts and
                        len(event.content.parts) > 0):

                        part = event.content.parts[0]

                        # Skip function calls and other non-text parts
                        if not hasattr(part, 'text') or part.text is None:
                            continue

                        # Parse the response
                        response_data = json.loads(part.text)
                        response_count += 1

                        # Write agent responses header on first response
                        if not agent_responses_header_written:
                            log_writer.write_agent_responses_header()
                            agent_responses_header_written = True

                        # Log raw response to file
                        log_writer.log_response(response_data, response_count)

                        # Display based on type
                        response_type = response_data.get("type", "unknown")

                        if response_type == "progress":
                            self._display_progress(response_data, log_writer)
                        elif response_type == "chat_message":
                            self._display_chat_message(response_data, log_writer)
                        else:
                            self._display_generic(response_data, log_writer)

                except (IndexError, AttributeError, TypeError, json.JSONDecodeError) as e:
                    log_writer.write(f"⚠ Warning: Could not parse event: {e}")
                    continue

        except Exception as e:
            status = "Failed"
            log_writer.write(f"\n❌ Error during agent execution: {e}")
            import traceback
            traceback.print_exc()
            # Also log traceback to file
            if log_writer.enable_file_logging:
                log_writer.write(traceback.format_exc(), to_file_only=True)

        finally:
            # Clean up only the ADK session row. Artifacts are reusable across
            # turns/replays and intentionally remain in the artifact backend.
            try:
                await self.runner.session_service.delete_session(
                    app_name=AGENT_APP_NAME, user_id=user_id, session_id=session_id
                )
                log_writer.write(f"🧹 Session {session_id} cleaned up")
            except Exception as del_err:
                log_writer.write(f"⚠ Session cleanup failed: {del_err}")

        log_writer.write(f"\n{'='*60}")
        log_writer.write(f"✅ Agent run completed ({response_count} responses)")
        log_writer.write(f"{'='*60}\n")

        # Write summary and close log file
        log_writer.write_summary(response_count, status)
        log_writer.close()

    def _display_progress(self, data: Dict[str, Any], log_writer: LogWriter):
        """Display progress update."""
        step_name = data.get("step_name", "Unknown")
        status = data.get("status", "unknown")
        details = data.get("details", {})

        status_emoji = {
            "started": "▶️",
            "completed": "✅",
            "failed": "❌",
            "in_progress": "⏳"
        }.get(status, "📍")

        timestamp = datetime.now().strftime("%H:%M:%S")
        log_writer.write(f"[{timestamp}] {status_emoji} [{status.upper()}] {step_name}")
        if details:
            for key, value in details.items():
                log_writer.write(f"   {key}: {value}")
        log_writer.write("")

    def _display_chat_message(self, data: Dict[str, Any], log_writer: LogWriter):
        """Display chat message."""
        message = data.get("message", "")
        metadata = data.get("metadata", {})

        timestamp = datetime.now().strftime("%H:%M:%S")
        log_writer.write(f"[{timestamp}] 💬 Chat Message:")
        log_writer.write(f"   {message}")
        if metadata:
            log_writer.write(f"   Metadata: {json.dumps(metadata, indent=2)}")
        log_writer.write("")

    def _display_generic(self, data: Dict[str, Any], log_writer: LogWriter):
        """Display generic response."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_writer.write(f"[{timestamp}] 📦 Response:")
        log_writer.write(json.dumps(data, indent=2))
        log_writer.write("")


def load_payload_file(file_path: str) -> Dict[str, Any]:
    """Load payload from a JSON file."""
    with open(file_path, 'r') as f:
        return json.load(f)


def create_sample_payloads():
    """Create sample payload files for testing."""
    samples_dir = Path("sample_payloads")
    samples_dir.mkdir(exist_ok=True)

    # Sample 1: Create App
    create_app_payload = {
        "app_name": "My Test App",
        "app_description": "A simple test application for the CLI",
        "app_type": "blog"
    }

    with open(samples_dir / "create_app.json", 'w') as f:
        json.dump(create_app_payload, f, indent=2)

    # Sample 2: Edit App
    edit_app_payload = {
        "app_config": {
            "uuid": "test-app-uuid",
            "name": "My Test App"
        },
        "edit_instruction": "Add a new section for testimonials"
    }

    with open(samples_dir / "edit_app.json", 'w') as f:
        json.dump(edit_app_payload, f, indent=2)

    # Sample 3: Blog Post
    blog_payload = {
        "app_config": {
            "uuid": "test-app-uuid",
            "name": "My Test App"
        },
        "blog_instruction": "Write a blog post about AI trends in 2025"
    }

    with open(samples_dir / "blog_post.json", 'w') as f:
        json.dump(blog_payload, f, indent=2)

    print(f"✓ Created sample payload files in '{samples_dir}/'")


async def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="CLI tool for testing the Exepad Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run with JSON payload from file (auto-generates log file)
  python agent_cli.py --mode create --payload-file sample_payloads/create_app.json

  # Run with inline JSON payload
  python agent_cli.py --mode edit --payload '{"edit_instruction": "Add a contact form"}'

  # Run with DEBUG log level (captures all system logs)
  python agent_cli.py --mode create --payload-file sample_payloads/create_app.json --log-level DEBUG

  # Run with custom log file path
  python agent_cli.py --mode create --payload-file sample_payloads/create_app.json --log-file my_run.log

  # Run without file logging (console only)
  python agent_cli.py --mode create --payload-file sample_payloads/create_app.json --no-log-file

  # Generate sample payload files
  python agent_cli.py --create-samples

  # Interactive mode (prompts for input)
  python agent_cli.py --interactive
        """
    )

    parser.add_argument(
        '--mode',
        type=str,
        help='Operation mode (e.g., create, edit, blog, help_desk)'
    )

    parser.add_argument(
        '--payload',
        type=str,
        help='JSON payload string'
    )

    parser.add_argument(
        '--payload-file',
        type=str,
        help='Path to JSON payload file'
    )

    parser.add_argument(
        '--user-id',
        type=str,
        default='test_user',
        help='User ID for the session (default: test_user)'
    )

    parser.add_argument(
        '--session-id',
        type=str,
        help='Session ID (will be generated if not provided)'
    )

    parser.add_argument(
        '--create-samples',
        action='store_true',
        help='Create sample payload files'
    )

    parser.add_argument(
        '--interactive',
        action='store_true',
        help='Run in interactive mode'
    )

    parser.add_argument(
        '--log-file',
        type=str,
        help='Path to log file (default: auto-generated in logs/ directory)'
    )

    parser.add_argument(
        '--no-log-file',
        action='store_true',
        help='Disable file logging (console output only)'
    )

    parser.add_argument(
        '--log-level',
        type=str,
        default='INFO',
        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        help='Logging level for system logs (default: INFO)'
    )

    args = parser.parse_args()

    # Handle sample creation
    if args.create_samples:
        create_sample_payloads()
        return

    # Handle interactive mode
    if args.interactive:
        print("🎮 Interactive Mode")
        print("=" * 60)

        mode = input("Enter operation mode (create/edit/blog/help_desk): ").strip()

        print("\nEnter payload (JSON format, press Enter then Ctrl+D when done):")
        print("Or enter a file path starting with '@' (e.g., @sample_payloads/create_app.json)")
        payload_input = input("> ").strip()

        if payload_input.startswith('@'):
            # Load from file
            payload_file = payload_input[1:]
            payload = load_payload_file(payload_file)
        else:
            # Try to parse as JSON
            try:
                payload = json.loads(payload_input)
            except json.JSONDecodeError:
                print("❌ Error: Invalid JSON payload")
                return

        user_id = input(f"User ID (default: test_user): ").strip() or "test_user"
        session_id = input("Session ID (leave empty to auto-generate): ").strip() or None

        # In interactive mode, use command line args if provided, otherwise use defaults
        if not hasattr(args, 'log_file'):
            args.log_file = None
        if not hasattr(args, 'no_log_file'):
            args.no_log_file = False
        if not hasattr(args, 'log_level'):
            args.log_level = 'INFO'

    else:
        # Non-interactive mode
        if not args.mode:
            parser.print_help()
            print("\n❌ Error: --mode is required (or use --interactive)")
            return

        mode = args.mode

        # Load payload
        if args.payload_file:
            payload = load_payload_file(args.payload_file)
        elif args.payload:
            try:
                payload = json.loads(args.payload)
            except json.JSONDecodeError:
                print("❌ Error: Invalid JSON payload")
                return
        else:
            payload = {}

        user_id = args.user_id
        session_id = args.session_id

    # Initialize CLI and run
    cli = AgentCLI()
    await cli.run_agent(
        operation_mode=mode,
        payload=payload,
        user_id=user_id,
        session_id=session_id,
        log_file_path=args.log_file,
        enable_file_logging=not args.no_log_file,
        log_level=args.log_level
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠ Interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

import sys
import os

# Add the parent directory to sys.path to enable absolute imports like 'from config import AgentName'
# This is needed because ADK loads main_agent directly
_current_file = os.path.abspath(__file__)
_current_dir = os.path.dirname(_current_file)
_agent_api_dir = os.path.dirname(_current_dir)  # agent_api directory
_backend_dir = os.path.dirname(_agent_api_dir)  # backend directory

if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# Add shared schemas Python scripts to path (packages/schemas/scripts/py/)
_repo_root = os.path.dirname(_backend_dir)
_schemas_py_dir = os.path.join(_repo_root, "packages", "schemas", "scripts", "py")
if _schemas_py_dir not in sys.path:
    sys.path.insert(0, _schemas_py_dir)

# Load environment variables BEFORE any imports that read env vars at module level
# (e.g., config.py reads AGENT_MODEL env overrides at import time).
# This is the single canonical load_dotenv() call for the entire agent package.
from dotenv import load_dotenv

load_dotenv()

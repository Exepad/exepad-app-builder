"""
exepad_schemas - Python utilities for Exepad JSON schema validation.

Provides validation, schema retrieval, and example utilities.
All data files live in packages/schemas/data/.
"""
import os

# Canonical data directory: packages/schemas/data/
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data'))

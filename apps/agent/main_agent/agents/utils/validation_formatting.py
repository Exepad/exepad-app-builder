"""Shared formatting utilities for validation results returned to agents."""


def format_validation_errors(errors: list[str], max_errors: int = 10) -> str:
    """Format validation errors into an agent-readable numbered list.

    Produces output like:
        Validation failed (3 error(s)):
          1. [root:SectionProps] error at 'uuid': 'uuid' is a required property
          2. [root:SectionProps] error at 'content[0]': ...
          3. [root:SectionProps] error at 'title': ...

    Args:
        errors: List of error message strings from the validator.
        max_errors: Maximum number of errors to display (default 10).

    Returns:
        Formatted error string for agent consumption.
    """
    if not errors:
        return "Validation failed with unknown errors."

    displayed = errors[:max_errors]
    lines = [f"  {i}. {err}" for i, err in enumerate(displayed, 1)]
    header = f"Validation failed ({len(errors)} error(s)):\n"
    body = "\n".join(lines)

    if len(errors) > max_errors:
        body += f"\n  ... and {len(errors) - max_errors} more errors"

    return header + body

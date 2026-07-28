"""Unit tests for ``OrphanFormInputRule`` — a form input's ``name="X"``
must be read by ``formData.get("X")`` somewhere in the file.

Regression target: coje33ih SettingsContent — 5 named inputs but only
3 read on submit. The two orphan inputs (``org_name``, ``dept_name``)
appeared functional in the UI but their values were dropped silently
because the bound handler never received them.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_orphan_form_input import (
    OrphanFormInputRule,
)


def _ctx(tsx: str) -> AstContext:
    return AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))


def _findings(tsx: str) -> list:
    return list(OrphanFormInputRule().check(_ctx(tsx)))


def test_orphan_input_flagged():
    # Two inputs, one read, one ignored — the second is the bug.
    tsx = """
    function C() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        const x = formData.get("kept");
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="kept" />
          <Input name="dropped" />
        </form>
      );
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "dropped" in findings[0].formatted_message()


def test_coje33ih_settings_regression():
    # Replays the actual SettingsContent pattern from coje33ih.
    tsx = """
    function SettingsContent() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        const payload = {
          projectionPeriod: parseInt(String(formData.get("projection_period") || "5")),
          currency: String(formData.get("currency") || "USD"),
          laborRate: parseFloat(String(formData.get("labor_rate") || "0")),
        };
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="projection_period" />
          <Input name="currency" />
          <Input name="labor_rate" />
          <Input name="org_name" />
          <Input name="dept_name" />
        </form>
      );
    }
    """
    findings = _findings(tsx)
    flagged = {f.formatted_message() for f in findings}
    # Both org_name and dept_name should be flagged; the 3 read fields not.
    assert any("org_name" in m for m in flagged)
    assert any("dept_name" in m for m in flagged)
    assert not any("projection_period" in m for m in flagged)
    assert not any("currency" in m for m in flagged)
    assert not any("labor_rate" in m for m in flagged)


def test_all_inputs_read_passes():
    tsx = """
    function C() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        const a = formData.get("a");
        const b = formData.get("b");
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="a" />
          <Input name="b" />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_no_form_in_file_bails():
    # Non-form components should never trigger this rule, even if some
    # raw input element has a name attr (e.g. a search box).
    tsx = """
    function C() {
      return (
        <div>
          <Input name="search" />
        </div>
      );
    }
    """
    assert _findings(tsx) == []


def test_form_without_onsubmit_is_ignored():
    # Forms that handle submission inline or via platform-form integrations
    # often omit onSubmit; we don't want to nag those.
    tsx = """
    function C() {
      return (
        <form>
          <Input name="anything" />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_getAll_counts_as_read():
    tsx = """
    function C() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        const tags = formData.getAll("tags");
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="tags" />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_aliased_formdata_receiver_recognised():
    # The agent occasionally aliases ``new FormData(e.currentTarget)`` —
    # we accept common receiver names (``fd``, ``form``, ``data``).
    tsx = """
    function C() {
      const handleSave = (e) => {
        const fd = new FormData(e.currentTarget);
        const x = fd.get("aliased");
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="aliased" />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_input_outside_form_not_flagged():
    # An ``<Input name="...">`` sibling of the form, not inside it,
    # is not in scope.
    tsx = """
    function C() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        const x = formData.get("inside");
      };
      return (
        <div>
          <Input name="outside" />
          <form onSubmit={handleSave}>
            <Input name="inside" />
          </form>
        </div>
      );
    }
    """
    # "outside" is unread but it's not inside any <form onSubmit>, so it's
    # out of scope. "inside" is read. No findings.
    assert _findings(tsx) == []


# ── controlled inputs must not be flagged (false positive, 2026-07-25) ───────
# Live: Cedar Ridge Lodge ContactContent drew 4 warnings claiming its fields
# were "dropped on submit". The form was a correct React controlled form; every
# value submitted fine. The rule only knew the uncontrolled FormData shape.
def test_controlled_input_not_flagged():
    tsx = """
    function C() {
      const [formData, setFormData] = React.useState({ name: "", email: "" });
      const handleSubmit = async (e) => {
        e.preventDefault();
        await create({ name: formData.name, email: formData.email });
      };
      return (
        <form onSubmit={handleSubmit}>
          <Input name="name" value={formData.name}
                 onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
          <Input name="email" value={formData.email}
                 onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_controlled_textarea_and_checkbox_not_flagged():
    tsx = """
    function C() {
      return (
        <form onSubmit={handleSubmit}>
          <Textarea name="message" value={msg} onChange={(e) => setMsg(e.target.value)} />
          <Checkbox name="billable" checked={billable} onCheckedChange={setBillable} />
          <Select name="project" value={proj} onValueChange={setProj} />
        </form>
      );
    }
    """
    assert _findings(tsx) == []


def test_value_without_a_change_handler_is_still_flagged():
    """A bound value with no way to edit it is NOT controlled — it may still be
    intended to submit via FormData, so the orphan signal is kept."""
    tsx = """
    function C() {
      return (
        <form onSubmit={handleSubmit}>
          <Input name="readonly_field" value={someValue} />
        </form>
      );
    }
    """
    assert len(_findings(tsx)) == 1


def test_change_handler_without_a_bound_value_is_still_flagged():
    """onChange used only for validation leaves the input uncontrolled."""
    tsx = """
    function C() {
      return (
        <form onSubmit={handleSubmit}>
          <Input name="loose" onChange={(e) => validate(e.target.value)} />
        </form>
      );
    }
    """
    assert len(_findings(tsx)) == 1


def test_mixed_form_flags_only_the_uncontrolled_orphan():
    """The original bug class must still fire alongside controlled siblings."""
    tsx = """
    function C() {
      return (
        <form onSubmit={handleSubmit}>
          <Input name="controlled" value={v} onChange={(e) => setV(e.target.value)} />
          <Input name="dropped" />
        </form>
      );
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "dropped" in findings[0].formatted_message()


def test_controlled_input_still_flagged_when_the_file_uses_formdata():
    """Adversarial review (2026-07-25): the exemption must not be unconditional.
    When a file DOES submit via formData.get(), that is its payload path — a
    named input the handler forgot to read is dropped whether or not it is
    controlled, which is the original coje33ih bug class."""
    tsx = """
    function C() {
      const handleSave = (e) => {
        const formData = new FormData(e.currentTarget);
        submit({ name: formData.get("name") });
      };
      return (
        <form onSubmit={handleSave}>
          <Input name="name" value={n} onChange={(e) => setN(e.target.value)} />
          <Input name="phone" value={p} onChange={(e) => setP(e.target.value)} />
        </form>
      );
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "phone" in findings[0].formatted_message()

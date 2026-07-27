---
name: multi-step-wizard
description: "Multi-step flows — onboarding, checkout, complex signup, surveys. Progress indicator, per-step validation, back/next safety, draft persistence via useAppState($persist). Load when the plan calls for a stepper, wizard, multi-page form, onboarding flow, or any UX that splits a long form into 3+ ordered steps. Keywords: wizard, stepper, multi-step, onboarding, checkout, survey, progress, steps, draft, form-wizard, signup-flow."
metadata:
  kind: domain
---
# Skill: Multi-Step Wizard / Stepper

Three-or-more-step flows with a progress indicator, per-step validation,
and draft persistence so the user can resume after a refresh.

## When to use a wizard

- 3+ logical steps (onboarding, complex signup, checkout).
- Per-step decisions affect later steps (branching).
- The full form has 10+ fields — split into chunks of 3–5 fields per step.
- Optional vs. required fields differ per step.

If the form is ≤ 6 fields, use a single `Dialog` instead — load the
`modal-dialog-patterns` skill.

## Canonical structure

```tsx
import { useAppState } from "@exepad/sdk";

interface SignupDraft {
  step: number;
  account?:  { email: string; password: string };
  profile?:  { name: string; role: string };
  workspace?: { teamName: string; teamSize: string };
}

const STEPS = ['Account', 'Profile', 'Workspace', 'Done'] as const;

export default function SignupWizard() {
  const [draft, setDraft] = useAppState<SignupDraft>('signup_draft$persist', { step: 0 });
  const step = draft.step;
  const total = STEPS.length;

  const goNext = () => setDraft({ ...draft, step: Math.min(step + 1, total - 1) });
  const goBack = () => setDraft({ ...draft, step: Math.max(step - 1, 0) });
  const update = <K extends keyof SignupDraft>(key: K, value: SignupDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <ProgressBar step={step} total={total - 1} labels={STEPS} />
      <div className="mt-10">
        {step === 0 && <AccountStep value={draft.account} onSave={(v) => { update('account', v); goNext(); }} />}
        {step === 1 && <ProfileStep value={draft.profile} onBack={goBack} onSave={(v) => { update('profile', v); goNext(); }} />}
        {step === 2 && <WorkspaceStep value={draft.workspace} onBack={goBack} onSave={(v) => { update('workspace', v); goNext(); }} />}
        {step === 3 && <DoneStep draft={draft} />}
      </div>
    </div>
  );
}
```

## Progress indicator

Two patterns — pick by step count:

**Numbered dot pattern (3–5 steps):**

```tsx
function ProgressBar({ step, total, labels }: { step: number; total: number; labels: readonly string[] }) {
  return (
    <div className="flex items-center justify-between">
      {labels.slice(0, total + 1).map((label, i) => (
        <div key={i} className="flex flex-col items-center flex-1">
          <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
            i < step ? 'bg-primary text-primary-foreground' :
            i === step ? 'bg-primary text-primary-foreground ring-4 ring-primary/20' :
            'bg-muted text-muted-foreground'
          }`}>
            {i < step ? <Icons.Check className="h-4 w-4" /> : i + 1}
          </div>
          <span className={`mt-2 text-xs ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
          {i < total && <div className={`absolute mt-4 h-0.5 ${i < step ? 'bg-primary' : 'bg-muted'}`} />}
        </div>
      ))}
    </div>
  );
}
```

**Linear bar pattern (6+ steps or unknown total):**

```tsx
<div className="flex items-center gap-3">
  <span className="text-sm text-muted-foreground">Step {step + 1} of {total + 1}</span>
  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
    <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / (total + 1)) * 100}%` }} />
  </div>
</div>
```

## Per-step component shape

Each step is a self-contained subcomponent that owns its local validation:

```tsx
function AccountStep({ value, onSave }: { value?: AccountDraft; onSave: (v: AccountDraft) => void }) {
  const [email, setEmail] = useState(value?.email ?? '');
  const [password, setPassword] = useState(value?.password ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit() {
    const e: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Enter a valid email';
    if (password.length < 8) e.password = 'At least 8 characters';
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave({ email, password });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Create your account</h2>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {errors.email && <p className="mt-1 text-sm text-destructive">{errors.email}</p>}
      </div>
      {/* password input similar */}
      <div className="flex justify-end">
        <Button onClick={submit}>Continue <Icons.ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
```

## Draft persistence

**Always use the `$persist` suffix on the state key** so a refresh
mid-flow doesn't lose the user's progress:

```tsx
const [draft, setDraft] = useAppState<SignupDraft>('signup_draft$persist', { step: 0 });
```

`$persist` writes through to `localStorage`. After successful submission
on the final step, clear the draft:

```tsx
async function finalSubmit() {
  await create(draft);
  setDraft({ step: 0 }); // clear
  navigate('/welcome');
}
```

## Back / Next / Skip rules

- **Back** preserves the current step's filled fields — don't wipe them.
- **Next is disabled until validation passes**, but the validation only fires on click — don't gate keystrokes.
- **Optional steps** show a "Skip" link in the corner (`variant="ghost"`),
  not as a primary action.
- **First step has no back button.** Last step's "Continue" reads
  "Submit" or "Finish" so the user knows it's the commit step.

## Branching steps

For conditional flows ("if user picks X, show step Y; else skip to Z"),
keep the linear `step` counter and gate per-step rendering:

```tsx
const NEEDS_INVITE = !!draft.account?.invitedTo;
const visibleSteps = NEEDS_INVITE ? STEPS : STEPS.filter((s) => s !== 'Invite');
```

Recompute `total` from `visibleSteps.length` so the progress indicator
reflects the user's actual journey.

## Anti-patterns

- ✗ Storing the wizard state in `useState` — page refresh wipes everything. Always use `useAppState('key$persist', ...)`.
- ✗ Validating all steps on first render. Only validate the active step.
- ✗ Showing every step's fields on screen with collapse panels — that's
  an accordion, not a wizard. Wizard means one step visible at a time.
- ✗ Putting "Save and exit" alongside "Continue". Pick one — the implicit auto-save via `$persist` already preserves drafts.
- ✗ Using `<form>` wrapping the whole wizard. Each step has its own form scope.

## Compatibility

`useAppState` is exported from `@exepad/sdk`. The `$persist` suffix is a platform convention — don't invent your own localStorage layer.

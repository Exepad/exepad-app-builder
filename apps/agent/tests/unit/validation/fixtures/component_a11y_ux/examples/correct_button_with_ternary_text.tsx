// Newsletter submit button — visible text is a ternary expression.
// Pattern from MainFooter on luna-rest (jmhd6gv7), previously flagged
// as icon-only because the detector skipped jsx_expression children.
import { Button } from "@exepad/sdk";

export default function NewsletterForm({ submitting, handleSubmit }) {
  return (
    <form onSubmit={handleSubmit}>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Joining..." : "Join Now"}
      </Button>
    </form>
  );
}

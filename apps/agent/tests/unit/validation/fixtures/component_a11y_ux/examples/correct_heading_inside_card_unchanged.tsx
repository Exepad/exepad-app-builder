import { Card, CardContent } from "@exepad/sdk";

export default function HomeContent() {
  return (
    <section>
      <h1>Page title</h1>
      <div>
        <Card>
          <CardContent>
            {/* Card-internal label. Not a section anchor — must not be
                promoted to <h2> by the heading-order fixer. */}
            <h3>Trafik Analizi</h3>
            <p>Real-time traffic chart inside a card widget.</p>
          </CardContent>
        </Card>
      </div>
      <h2>Another section</h2>
    </section>
  );
}

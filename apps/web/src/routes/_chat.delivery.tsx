import { createFileRoute } from "@tanstack/react-router";

const fixture = {
  ticket: "LAB-74",
  owner: "Lab controller",
  model: "Codex Luna · Low",
  reservation: 20_000,
  usage: null,
  qa: "Awaiting review",
  head: "2222222222222222222222222222222222222222",
  ci: { head: "1111111111111111111111111111111111111111", status: "Passed" },
};

function DeliveryPage() {
  const ciStatus = fixture.ci.head === fixture.head ? fixture.ci.status : "Stale";
  const fields = [
    ["Owner", fixture.owner],
    ["Model", fixture.model],
    ["Reserved tokens", fixture.reservation.toLocaleString()],
    ["Observed usage", fixture.usage ?? "Unknown"],
    ["Independent QA", fixture.qa],
    ["Current commit", fixture.head],
    ["CI", ciStatus],
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto p-6">
      <h1 className="text-lg font-semibold">Delivery</h1>
      <article className="mt-4 max-w-2xl rounded-lg border p-4">
        <h2 className="font-medium">{fixture.ticket} · Lab fixture</h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          {fields.map(([label, value]) => (
            <div className="contents" key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </main>
  );
}

export const Route = createFileRoute("/_chat/delivery")({
  component: DeliveryPage,
});

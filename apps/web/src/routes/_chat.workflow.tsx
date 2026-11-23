import { createFileRoute, redirect } from "@tanstack/react-router";

// The fork's thread-activity page used to live at /workflow, which read like upstream's durable /workflows.
// Old links and bookmarks keep working and land on the renamed page with their search intact.
export const Route = createFileRoute("/_chat/workflow")({
  validateSearch: (search: Record<string, unknown>) => ({
    environment: typeof search.environment === "string" ? search.environment : undefined,
    thread: typeof search.thread === "string" ? search.thread : undefined,
    run: typeof search.run === "string" ? search.run : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/thread-activity", search });
  },
});

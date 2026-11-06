import { notFound } from "next/navigation";
import { Workspace } from "../../../components/workspace/Workspace";
import { listLiveExercises } from "../../../lib/exercises/content";

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const all = listLiveExercises();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) notFound();
  // Explicit picks: only what the workspace needs (no solution, no fallback hints, no status).
  const { title, statement, starterCode, tests } = all[i];
  return (
    <main className="wide">
      <Workspace exercise={{ id, title, statement, starterCode, tests }} nextId={all[i + 1]?.id} />
    </main>
  );
}

import { notFound } from "next/navigation";
import { Workspace } from "../../../components/workspace/Workspace";
import { SAMPLE_EXERCISES, findSample } from "../sample-data";

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exercise = findSample(id);
  if (!exercise) notFound();
  const i = SAMPLE_EXERCISES.findIndex((e) => e.id === id);
  return (
    <main className="wide">
      <Workspace exercise={exercise} nextId={SAMPLE_EXERCISES[i + 1]?.id} />
    </main>
  );
}

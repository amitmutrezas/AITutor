import { ExerciseList } from "../../components/workspace/ExerciseList";
import { listLiveExercises } from "../../lib/exercises/content";

export const metadata = { title: "Exercises | Unstuck" };

export default function ExercisesPage() {
  const exercises = listLiveExercises().map(({ id, title }) => ({ id, title }));
  return (
    <main className="wide">
      <h1>Exercises</h1>
      <p>Pick an exercise. Solved ones are marked on this device.</p>
      <ExerciseList exercises={exercises} />
    </main>
  );
}

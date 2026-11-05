import { ExerciseList } from "../../components/workspace/ExerciseList";
import { SAMPLE_EXERCISES } from "./sample-data";

export const metadata = { title: "Exercises | Unstuck" };

export default function ExercisesPage() {
  return (
    <main className="wide">
      <h1>Exercises</h1>
      <p>Pick an exercise. Solved ones are marked on this device.</p>
      <ExerciseList exercises={SAMPLE_EXERCISES.map(({ id, title }) => ({ id, title }))} />
    </main>
  );
}

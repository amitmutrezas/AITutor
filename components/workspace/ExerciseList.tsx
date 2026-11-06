"use client";
import Link from "next/link";
import type { RunnableExercise } from "../../lib/runner/types";
import { useSolved } from "./solved";

export function ExerciseList({
  exercises,
}: {
  exercises: Pick<RunnableExercise, "id" | "title">[];
}) {
  const solved = useSolved();
  return (
    <ul className="tests-list" aria-label="Exercises">
      {exercises.map((e) => {
        const done = solved.includes(e.id);
        return (
          <li key={e.id} className="ex-row">
            <Link href={`/exercises/${e.id}`}>{e.title}</Link>
            <span className={done ? "pill solved" : "pill"}>{done ? "Solved" : "Not solved"}</span>
          </li>
        );
      })}
    </ul>
  );
}

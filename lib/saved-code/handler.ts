import { z } from "zod";
import { failed, json, readBody, readQuery } from "../api/http";
import { requireUser } from "../auth/session";
import type { Authenticate } from "../auth/types";
import { SAVED_CODE } from "../config";
import type { SavedCodePort } from "./service";

export const exerciseIdSchema = z
  .string()
  .min(1)
  .max(SAVED_CODE.maxExerciseIdChars)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const saveBody = z.strictObject({
  exerciseId: exerciseIdSchema,
  code: z.string().max(SAVED_CODE.maxChars),
});

/** Exactly one of `exerciseId` (delete one) or `all=true` (delete all). */
export const deleteQuery = z
  .strictObject({ exerciseId: exerciseIdSchema.optional(), all: z.literal("true").optional() })
  .refine((q) => (q.exerciseId === undefined) !== (q.all === undefined));

export interface SavedCodeDeps {
  authenticate: Authenticate;
  savedCode: SavedCodePort;
}

/**
 * Saved code API (A2). Learner code is stored for the learner (POLICY 2.1) and is never logged:
 * no console output in this module touches `code` (N3, POLICY 2.2).
 */
export function createSavedCodeHandlers(deps: SavedCodeDeps) {
  return {
    async GET(req: Request): Promise<Response> {
      const auth = await requireUser(req, deps.authenticate);
      if (!auth.ok) return auth.response;
      try {
        return json(200, { items: await deps.savedCode.list(auth.user.id) });
      } catch {
        return failed();
      }
    },

    /** Save on run: replaces the latest code for this exercise. */
    async PUT(req: Request): Promise<Response> {
      const auth = await requireUser(req, deps.authenticate);
      if (!auth.ok) return auth.response;
      const body = await readBody(req, saveBody);
      if (!body.ok) return body.response;
      try {
        await deps.savedCode.save(auth.user.id, body.data.exerciseId, body.data.code);
        return json(200, { saved: true });
      } catch {
        return failed();
      }
    },

    async DELETE(req: Request): Promise<Response> {
      const auth = await requireUser(req, deps.authenticate);
      if (!auth.ok) return auth.response;
      const q = readQuery(req, deleteQuery);
      if (!q.ok) return q.response;
      try {
        if (q.data.exerciseId !== undefined) {
          const deleted = await deps.savedCode.deleteOne(auth.user.id, q.data.exerciseId);
          return json(200, { deleted: deleted ? 1 : 0 });
        }
        return json(200, { deleted: await deps.savedCode.deleteAll(auth.user.id) });
      } catch {
        return failed();
      }
    },
  };
}

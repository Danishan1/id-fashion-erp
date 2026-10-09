import { z } from "zod";

export const noteBodySchema = z.string().trim().min(1, "Write something first").max(10000, "Notes are at most 10,000 characters");
export const createNoteSchema = z.object({ body: noteBodySchema });
export const updateNoteSchema = z.object({ body: noteBodySchema });

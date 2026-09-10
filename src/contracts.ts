import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const idSchema = z.string().min(1).max(256);
export const scopeSchema = z
  .object({
    hostId: idSchema,
    instanceId: idSchema,
    generation: idSchema,
    threadId: idSchema,
  })
  .strict();
export const targetSchema = scopeSchema.extend({ tabId: idSchema }).strict();
export type Target = z.infer<typeof targetSchema>;
export const copyModeSchema = z.enum(["text", "element-image", "screen-image"]);
export type CopyMode = z.infer<typeof copyModeSchema>;

export const pageSnapshotSchema = z.object({
  documentId: z.string().min(1),
  url: z.string(),
  width: z.number().finite(),
  height: z.number().finite(),
  scrollX: z.number().finite(),
  scrollY: z.number().finite(),
  scale: z.number().finite(),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export const elementInfoSchema = z.object({
  tag: z.string(),
  selector: z.string(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  text: z.string().nullable(),
  link: z.string().nullable(),
  value: z.string().nullable(),
  rect: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite(),
    })
    .strict(),
});
export type ElementInfo = z.infer<typeof elementInfoSchema>;

export const imageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Image = z.infer<typeof imageSchema>;

export const hostContract = {
  elementPick: {
    input: z
      .object({
        wsEndpoint: z.string().url(),
        image: z.boolean(),
      })
      .strict(),
    output: z
      .object({
        element: elementInfoSchema,
        image: imageSchema.nullable(),
        copied: z.boolean(),
      })
      .strict(),
  },
  screenPick: {
    input: z.object({ wsEndpoint: z.string().url() }).strict(),
    output: z
      .object({
        image: imageSchema,
        copied: z.boolean(),
      })
      .strict(),
  },
} satisfies PluginRpcContract;

export const rpcContract = {
  discover: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z
      .object({
        targets: z
          .array(
            z
              .object({
                hostId: idSchema,
                instanceId: idSchema,
                generation: idSchema,
                tab: z.object({
                  tabId: idSchema,
                  title: z.string(),
                  url: z.string(),
                }),
              })
              .strict(),
          )
          .max(1000),
      })
      .strict(),
  },
  copy: {
    input: targetSchema
      .extend({
        mode: copyModeSchema,
        page: pageSnapshotSchema.nullable(),
      })
      .strict(),
    output: z
      .object({
        element: elementInfoSchema.nullable(),
        image: imageSchema.nullable(),
        copied: z.boolean(),
      })
      .strict(),
  },
} satisfies PluginRpcContract;

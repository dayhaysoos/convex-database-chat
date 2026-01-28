import type { Id } from "./_generated/dataModel";

type DbCtx = {
  db: {
    get: (id: Id<"conversations"> | Id<"streamingMessages">) => Promise<any>;
  };
};

function notFound(): never {
  throw new Error("Not found");
}

export async function requireConversationExternalId(
  ctx: DbCtx,
  conversationId: Id<"conversations">,
  externalId: string
) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation || conversation.externalId !== externalId) {
    notFound();
  }
  return conversation;
}

export async function requireStreamExternalId(
  ctx: DbCtx,
  streamId: Id<"streamingMessages">,
  externalId: string
) {
  const stream = await ctx.db.get(streamId);
  if (!stream) {
    notFound();
  }
  await requireConversationExternalId(ctx, stream.conversationId, externalId);
  return stream;
}

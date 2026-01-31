import type { DatabaseChatTool } from "./tools";

export type ToolExecutionContext = {
  runQuery: (handler: any, args: Record<string, unknown>) => Promise<unknown>;
  runMutation: (handler: any, args: Record<string, unknown>) => Promise<unknown>;
  runAction: (handler: any, args: Record<string, unknown>) => Promise<unknown>;
};

export function mergeToolArgs(
  parsedArgs: Record<string, unknown>,
  toolContext?: Record<string, unknown>
): Record<string, unknown> {
  if (!toolContext || Object.keys(toolContext).length === 0) {
    return { ...parsedArgs };
  }
  return { ...parsedArgs, ...toolContext };
}

export async function executeToolWithContext(
  ctx: ToolExecutionContext,
  tool: DatabaseChatTool,
  parsedArgs: Record<string, unknown>,
  toolContext?: Record<string, unknown>
): Promise<{ result: unknown; args: Record<string, unknown> }> {
  const mergedArgs = mergeToolArgs(parsedArgs, toolContext);
  const result = await executeToolHandler(ctx, tool, mergedArgs);
  return { result, args: mergedArgs };
}

async function executeToolHandler(
  ctx: ToolExecutionContext,
  tool: DatabaseChatTool,
  args: Record<string, unknown>
) {
  const handlerType = tool.handlerType ?? "query";
  switch (handlerType) {
    case "mutation":
      return await ctx.runMutation(tool.handler as any, args);
    case "action":
      return await ctx.runAction(tool.handler as any, args);
    case "query":
    default:
      return await ctx.runQuery(tool.handler as any, args);
  }
}

import "server-only";
import {
  LoadAPIKeyError,
  UIMessage,
  Tool,
  jsonSchema,
  tool as createTool,
  isToolUIPart,
  UIMessagePart,
  ToolUIPart,
  getToolName,
  UIMessageStreamWriter,
} from "ai";
import {
  ChatMention,
  ChatMetadata,
  ManualToolConfirmTag,
} from "app-types/chat";
import { errorToString, exclude, objectFlow } from "lib/utils";
import logger from "logger";
import {
  AllowedMCPServer,
  McpServerCustomizationsPrompt,
  VercelAIMcpTool,
  VercelAIMcpToolTag,
} from "app-types/mcp";
import { MANUAL_REJECT_RESPONSE_PROMPT } from "lib/ai/prompts";

import { ObjectJsonSchema7 } from "app-types/util";
import { safe } from "ts-safe";
import { workflowRepository } from "lib/db/repository";

import {
  VercelAIWorkflowTool,
  VercelAIWorkflowToolStreaming,
  VercelAIWorkflowToolStreamingResultTag,
  VercelAIWorkflowToolTag,
} from "app-types/workflow";
import { createWorkflowExecutor } from "lib/ai/workflow/executor/workflow-executor";
import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";
import { APP_DEFAULT_TOOL_KIT } from "lib/ai/tools/tool-kit";
import { AppDefaultToolkit } from "lib/ai/tools";

export function filterMCPToolsByMentions(
  tools: Record<string, VercelAIMcpTool>,
  mentions: ChatMention[],
) {
  if (mentions.length === 0) {
    return tools;
  }
  const toolMentions = mentions.filter(
    (mention) => mention.type == "mcpTool" || mention.type == "mcpServer",
  );

  const metionsByServer = toolMentions.reduce(
    (acc, mention) => {
      if (mention.type == "mcpServer") {
        return {
          ...acc,
          [mention.serverId]: Object.values(tools).map(
            (tool) => tool._originToolName,
          ),
        };
      }
      return {
        ...acc,
        [mention.serverId]: [...(acc[mention.serverId] ?? []), mention.name],
      };
    },
    {} as Record<string, string[]>,
  );

  return objectFlow(tools).filter((_tool) => {
    if (!metionsByServer[_tool._mcpServerId]) return false;
    return metionsByServer[_tool._mcpServerId].includes(_tool._originToolName);
  });
}

export function filterMCPToolsByAllowedMCPServers(
  tools: Record<string, VercelAIMcpTool>,
  allowedMcpServers?: Record<string, AllowedMCPServer>,
): Record<string, VercelAIMcpTool> {
  if (!allowedMcpServers || Object.keys(allowedMcpServers).length === 0) {
    return {};
  }
  return objectFlow(tools).filter((_tool) => {
    if (!allowedMcpServers[_tool._mcpServerId]?.tools) return false;
    return allowedMcpServers[_tool._mcpServerId].tools.includes(
      _tool._originToolName,
    );
  });
}

export function excludeToolExecution(
  tool: Record<string, Tool>,
): Record<string, Tool> {
  return objectFlow(tool).map((value) => {
    return createTool({
      inputSchema: value.inputSchema,
      description: value.description,
    });
  });
}

export function mergeSystemPrompt(
  ...prompts: (string | undefined | false)[]
): string {
  const filteredPrompts = prompts
    .map((prompt) => (prompt ? prompt.trim() : ""))
    .filter(Boolean);
  return filteredPrompts.join("\n\n");
}

export function manualToolExecuteByLastMessage(
  part: ToolUIPart,
  tools: Record<string, VercelAIMcpTool | VercelAIWorkflowTool | Tool>,
  abortSignal?: AbortSignal,
) {
  const { input } = part;

  const toolName = getToolName(part);

  const tool = tools[toolName];
  return safe(() => {
    if (!tool) throw new Error(`tool not found: ${toolName}`);
    if (!ManualToolConfirmTag.isMaybe(part.output))
      throw new Error("manual tool confirm not found");
    return part.output;
  })
    .map(({ confirm }) => {
      if (!confirm) return MANUAL_REJECT_RESPONSE_PROMPT;
      if (VercelAIWorkflowToolTag.isMaybe(tool)) {
        return tool.execute!(input, {
          toolCallId: part.toolCallId,
          abortSignal: abortSignal ?? new AbortController().signal,
          messages: [],
        });
      } else if (VercelAIMcpToolTag.isMaybe(tool)) {
        return mcpClientsManager.toolCall(
          tool._mcpServerId,
          tool._originToolName,
          input,
        );
      }
      return tool.execute!(input, {
        toolCallId: part.toolCallId,
        abortSignal: abortSignal ?? new AbortController().signal,
        messages: [],
      });
    })
    .ifFail((error) => ({
      isError: true,
      statusMessage: `tool call fail: ${toolName}`,
      error: errorToString(error),
    }))
    .unwrap();
}

export function handleError(error: any) {
  if (LoadAPIKeyError.isInstance(error)) {
    return error.message;
  }
  logger.error(error);
  logger.error(`Route Error: ${error.name}`);
  return errorToString(error.message);
}

export function extractInProgressToolPart(message: UIMessage): ToolUIPart[] {
  if (message.role != "assistant") return [];
  if ((message.metadata as ChatMetadata)?.toolChoice != "manual") return [];
  return message.parts.filter(
    (part) =>
      isToolUIPart(part) &&
      part.state == "output-available" &&
      ManualToolConfirmTag.isMaybe(part.output),
  ) as ToolUIPart[];
}

export function filterMcpServerCustomizations(
  tools: Record<string, VercelAIMcpTool>,
  mcpServerCustomization: Record<string, McpServerCustomizationsPrompt>,
): Record<string, McpServerCustomizationsPrompt> {
  const toolNamesByServerId = Object.values(tools).reduce(
    (acc, tool) => {
      if (!acc[tool._mcpServerId]) acc[tool._mcpServerId] = [];
      acc[tool._mcpServerId].push(tool._originToolName);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  return Object.entries(mcpServerCustomization).reduce(
    (acc, [serverId, mcpServerCustomization]) => {
      if (!(serverId in toolNamesByServerId)) return acc;

      if (
        !mcpServerCustomization.prompt &&
        !Object.keys(mcpServerCustomization.tools ?? {}).length
      )
        return acc;

      const prompts: McpServerCustomizationsPrompt = {
        id: serverId,
        name: mcpServerCustomization.name,
        prompt: mcpServerCustomization.prompt,
        tools: mcpServerCustomization.tools
          ? objectFlow(mcpServerCustomization.tools).filter((_, key) => {
              return toolNamesByServerId[serverId].includes(key as string);
            })
          : {},
      };

      acc[serverId] = prompts;

      return acc;
    },
    {} as Record<string, McpServerCustomizationsPrompt>,
  );
}

export const workflowToVercelAITool = ({
  id,
  description,
  schema,
  dataStream,
  name,
}: {
  id: string;
  name: string;
  description?: string;
  schema: ObjectJsonSchema7;
  dataStream: UIMessageStreamWriter;
}): VercelAIWorkflowTool => {
  const toolName = name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();

  const tool = createTool({
    description: `${name} ${description?.trim().slice(0, 50)}`,
    inputSchema: jsonSchema(schema),
    execute(query, { toolCallId, abortSignal }) {
      const history: VercelAIWorkflowToolStreaming[] = [];
      const toolResult = VercelAIWorkflowToolStreamingResultTag.create({
        toolCallId,
        workflowName: name,

        startedAt: Date.now(),
        endedAt: Date.now(),
        history,
        result: undefined,
        status: "running",
      });
      return safe(id)
        .map((id) =>
          workflowRepository.selectStructureById(id, {
            ignoreNote: true,
          }),
        )
        .map((workflow) => {
          if (!workflow) throw new Error("Not Found Workflow");
          const executor = createWorkflowExecutor({
            nodes: workflow.nodes,
            edges: workflow.edges,
          });
          toolResult.workflowIcon = workflow.icon;

          abortSignal?.addEventListener("abort", () => executor.exit());
          executor.subscribe((e) => {
            if (
              e.eventType == "WORKFLOW_START" ||
              e.eventType == "WORKFLOW_END"
            )
              return;
            if (e.node.name == "SKIP") return;
            if (e.eventType == "NODE_START") {
              const node = workflow.nodes.find(
                (node) => node.id == e.node.name,
              )!;
              if (!node) return;
              history.push({
                id: e.nodeExecutionId,
                name: node.name,
                status: "running",
                startedAt: e.startedAt,
                kind: node.kind as NodeKind,
              });
            } else if (e.eventType == "NODE_END") {
              const result = history.find((r) => r.id == e.nodeExecutionId);
              if (result) {
                if (e.isOk) {
                  result.status = "success";
                  result.result = {
                    input: e.node.output.getInput(e.node.name),
                    output: e.node.output.getOutput({
                      nodeId: e.node.name,
                      path: [],
                    }),
                  };
                } else {
                  result.status = "fail";
                  result.error = {
                    name: e.error?.name || "ERROR",
                    message: errorToString(e.error),
                  };
                }
                result.endedAt = e.endedAt;
              }
            }

            dataStream.write({
              type: "tool-output-available",
              toolCallId,
              output: toolResult,
            });
          });
          return executor.run(
            {
              query: query ?? ({} as any),
            },
            {
              disableHistory: true,
            },
          );
        })
        .map((result) => {
          toolResult.endedAt = Date.now();
          toolResult.status = result.isOk ? "success" : "fail";
          toolResult.error = result.error
            ? {
                name: result.error.name || "ERROR",
                message: errorToString(result.error) || "Unknown Error",
              }
            : undefined;
          const outputNodeResults = history
            .filter((h) => h.kind == NodeKind.Output)
            .map((v) => v.result?.output)
            .filter(Boolean);
          toolResult.history = history.map((h) => ({
            ...h,
            result: undefined, // save tokens.
          }));
          toolResult.result =
            outputNodeResults.length == 1
              ? outputNodeResults[0]
              : outputNodeResults;
          return toolResult;
        })
        .ifFail((err) => {
          return {
            error: {
              name: err?.name || "ERROR",
              message: errorToString(err),
              history,
            },
          };
        })
        .unwrap();
    },
  }) as VercelAIWorkflowTool;

  tool._workflowId = id;
  tool._originToolName = name;
  tool._toolName = toolName;

  return VercelAIWorkflowToolTag.create(tool);
};

export const workflowToVercelAITools = (
  workflows: {
    id: string;
    name: string;
    description?: string;
    schema: ObjectJsonSchema7;
  }[],
  dataStream: UIMessageStreamWriter,
) => {
  return workflows
    .map((v) =>
      workflowToVercelAITool({
        ...v,
        dataStream,
      }),
    )
    .reduce(
      (prev, cur) => {
        prev[cur._toolName] = cur;
        return prev;
      },
      {} as Record<string, VercelAIWorkflowTool>,
    );
};

export const loadMcpTools = (opt?: {
  mentions?: ChatMention[];
  allowedMcpServers?: Record<string, AllowedMCPServer>;
}) =>
  safe(() => mcpClientsManager.tools())
    .map((tools) => {
      if (opt?.mentions?.length) {
        return filterMCPToolsByMentions(tools, opt.mentions);
      }
      return filterMCPToolsByAllowedMCPServers(tools, opt?.allowedMcpServers);
    })
    .orElse({} as Record<string, VercelAIMcpTool>);

export const loadWorkFlowTools = (opt: {
  mentions?: ChatMention[];
  dataStream: UIMessageStreamWriter;
}) =>
  safe(() =>
    opt?.mentions?.length
      ? workflowRepository.selectToolByIds(
          opt?.mentions
            ?.filter((m) => m.type == "workflow")
            .map((v) => v.workflowId),
        )
      : [],
  )
    .map((tools) => workflowToVercelAITools(tools, opt.dataStream))
    .orElse({} as Record<string, VercelAIWorkflowTool>);

export const loadAppDefaultTools = (opt?: {
  mentions?: ChatMention[];
  allowedAppDefaultToolkit?: string[];
}) =>
  safe(APP_DEFAULT_TOOL_KIT)
    .map((tools) => {
      if (opt?.mentions?.length) {
        const defaultToolMentions = opt.mentions.filter(
          (m) => m.type == "defaultTool",
        );
        return Array.from(Object.values(tools)).reduce((acc, t) => {
          const allowed = objectFlow(t).filter((_, k) => {
            return defaultToolMentions.some((m) => m.name == k);
          });
          return { ...acc, ...allowed };
        }, {});
      }
      const allowedAppDefaultToolkit =
        opt?.allowedAppDefaultToolkit ?? Object.values(AppDefaultToolkit);

      return (
        allowedAppDefaultToolkit.reduce(
          (acc, key) => {
            return { ...acc, ...tools[key] };
          },
          {} as Record<string, Tool>,
        ) || {}
      );
    })
    .ifFail((e) => {
      console.error(e);
      throw e;
    })
    .orElse({} as Record<string, Tool>);

export const convertToSavePart = <T extends UIMessagePart<any, any>>(
  part: T,
) => {
  return safe(
    exclude(part as any, ["providerMetadata", "callProviderMetadata"]) as T,
  )
    .map((v) => {
      if (isToolUIPart(v) && v.state.startsWith("output")) {
        if (VercelAIWorkflowToolStreamingResultTag.isMaybe(v.output)) {
          return {
            ...v,
            output: {
              ...v.output,
              history: v.output.history.map((h: any) => {
                return {
                  ...h,
                  result: undefined,
                };
              }),
            },
          };
        }
      }
      return v;
    })
    .unwrap();
};

export const fetchFileContentForAI = async (
  fileUrl: string,
  mediaType: string,
): Promise<string | null> => {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      logger.warn(
        `Failed to fetch file content from ${fileUrl}: ${response.status}`,
      );
      return null;
    }

    // Handle different file types appropriately
    if (
      mediaType.startsWith("text/") ||
      mediaType === "application/json" ||
      mediaType === "text/csv" ||
      mediaType === "text/markdown"
    ) {
      // For text-based files, return as text
      return await response.text();
    } else {
      // For binary files, convert to base64
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      return btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
    }
  } catch (error) {
    logger.error(`Error fetching file content from ${fileUrl}:`, error);
    return null;
  }
};

export const sanitizeUIMessagesForConversion = async (
  messages: UIMessage[],
): Promise<UIMessage[]> => {
  const processedMessages: UIMessage[] = [];

  for (const message of messages) {
    // Only process messages that have parts
    if (!message.parts) {
      processedMessages.push(message);
      continue;
    }

    const validParts: any[] = [];

    // Process each part individually to avoid nested Promise issues
    for (const part of message.parts) {
      // Handle text parts - ensure they have valid text content
      if (part.type === "text") {
        const textPart = part as any;
        if (!textPart.text || typeof textPart.text !== "string") {
          logger.warn("Removing malformed text part:", part);
          continue; // Skip this part
        }
        // Remove empty text parts
        if (textPart.text.trim().length === 0) {
          logger.warn("Removing empty text part");
          continue; // Skip this part
        }
        validParts.push(part);
        continue;
      }

      // Handle image parts - validate required properties
      if ((part as any).type === "image") {
        const imagePart = part as any;

        // Check for image property (URL or base64 data)
        if (!imagePart.image) {
          logger.warn(
            "Removing malformed image part missing image property:",
            part,
          );
          continue; // Skip this part
        }

        // Validate image property is a string
        if (typeof imagePart.image !== "string") {
          logger.warn(
            "Removing image part with invalid image property type:",
            part,
          );
          continue; // Skip this part
        }

        // If it has a mediaType property, validate it
        if (imagePart.mediaType && typeof imagePart.mediaType !== "string") {
          logger.warn(
            "Image part has invalid mediaType, removing mediaType property",
          );
          delete imagePart.mediaType;
        }

        logger.info("Valid image part found");
        validParts.push(part);
        continue;
      }

      // Handle file parts with comprehensive validation and fixing
      if (part.type === "file") {
        const filePart = part as any;

        // Essential validation - must have either data or url
        if (!filePart.data && !filePart.url) {
          logger.warn("Removing file part - missing both data and url:", part);
          continue; // Skip this part
        }

        // Validate data property if present
        if (filePart.data && typeof filePart.data !== "string") {
          logger.warn(
            "Removing file part - data property is not a string:",
            part,
          );
          continue; // Skip this part
        }

        // Handle missing data but has URL - attempt to fetch content
        if (!filePart.data && filePart.url) {
          logger.info(
            "File part has URL but no data - attempting to fetch content:",
            {
              name: filePart.name,
              url: filePart.url,
              mediaType: filePart.mediaType,
            },
          );

          try {
            const fetchedContent = await fetchFileContentForAI(
              filePart.url,
              filePart.mediaType,
            );
            if (fetchedContent) {
              filePart.data = fetchedContent;
              logger.info(
                `Successfully fetched content for file: ${filePart.name}, length: ${fetchedContent.length}`,
              );
            } else {
              logger.warn(
                `Failed to fetch content for file: ${filePart.name}, removing file part`,
              );
              continue; // Skip this part
            }
          } catch (error) {
            logger.error(
              `Error fetching file content for ${filePart.name}:`,
              error,
            );
            continue; // Skip this part
          }
        }

        // Fix inconsistent property naming: mimeType -> mediaType
        if (!filePart.mediaType && filePart.mimeType) {
          filePart.mediaType = filePart.mimeType;
          delete filePart.mimeType;
          logger.info("Fixed property naming: mimeType -> mediaType");
        }

        // Validate or infer mediaType (required by AI SDK)
        if (!filePart.mediaType) {
          logger.warn(
            "File part missing mediaType, attempting to infer:",
            part,
          );

          // Try to infer from filename extension
          if (filePart.name && typeof filePart.name === "string") {
            const extension = filePart.name.split(".").pop()?.toLowerCase();
            const mediaTypeMap: Record<string, string> = {
              // Images
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              gif: "image/gif",
              webp: "image/webp",
              // Documents
              pdf: "application/pdf",
              txt: "text/plain",
              csv: "text/csv",
              json: "application/json",
              md: "text/markdown",
              markdown: "text/markdown",
              // Code files
              js: "text/javascript",
              ts: "application/typescript",
              py: "text/x-python",
              html: "text/html",
              css: "text/css",
              // Office documents
              docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              xls: "application/vnd.ms-excel",
              // Archives
              zip: "application/zip",
            };

            if (extension && mediaTypeMap[extension]) {
              filePart.mediaType = mediaTypeMap[extension];
              logger.info(
                `Inferred mediaType: ${filePart.mediaType} for file: ${filePart.name}`,
              );
            } else {
              logger.warn(
                `Unknown file extension: ${extension}, using default mediaType`,
              );
              filePart.mediaType = "application/octet-stream";
            }
          } else {
            logger.warn(
              "Cannot infer mediaType - no filename available, using default",
            );
            filePart.mediaType = "application/octet-stream";
          }
        }

        // Final validation of mediaType
        if (
          typeof filePart.mediaType !== "string" ||
          filePart.mediaType.trim().length === 0
        ) {
          logger.warn(
            "Invalid mediaType after processing, using default:",
            filePart.mediaType,
          );
          filePart.mediaType = "application/octet-stream";
        }

        // Ensure name property is present and valid
        if (!filePart.name || typeof filePart.name !== "string") {
          logger.warn(
            "File part missing or invalid name property, generating default",
          );
          filePart.name = `file_${Date.now()}.${filePart.mediaType.split("/")[1] || "bin"}`;
        }

        // Clean up any undefined/null properties that might cause issues
        Object.keys(filePart).forEach((key) => {
          if (filePart[key] === undefined || filePart[key] === null) {
            delete filePart[key];
          }
        });

        logger.info("Successfully validated/fixed file part:", {
          name: filePart.name,
          mediaType: filePart.mediaType,
          hasData: !!filePart.data,
          hasUrl: !!filePart.url,
          dataLength: filePart.data ? filePart.data.length : 0,
        });

        validParts.push(part);
        continue;
      }

      // Handle tool parts (let them pass through without modification)
      if (part.type === "tool-call" || part.type === "tool-result") {
        validParts.push(part);
        continue;
      }

      // Unknown part type - log and filter out to be safe
      logger.warn("Unknown part type encountered:", part.type, part);
      // Skip unknown parts
    }

    // Add the processed message with valid parts
    processedMessages.push({
      ...message,
      parts: validParts,
    });
  }

  return processedMessages;
};

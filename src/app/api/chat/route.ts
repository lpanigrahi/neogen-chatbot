import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
  UIMessage,
} from "ai";

import { customModelProvider, isToolCallUnsupportedModel } from "lib/ai/models";

import { mcpClientsManager } from "lib/ai/mcp/mcp-manager";

import { agentRepository, chatRepository } from "lib/db/repository";
import globalLogger from "logger";
import {
  buildMcpServerCustomizationsSystemPrompt,
  buildUserSystemPrompt,
  buildToolCallUnsupportedModelSystemPrompt,
} from "lib/ai/prompts";
import { chatApiSchemaRequestBodySchema, ChatMetadata } from "app-types/chat";

import { errorIf, safe } from "ts-safe";

import {
  excludeToolExecution,
  handleError,
  manualToolExecuteByLastMessage,
  mergeSystemPrompt,
  extractInProgressToolPart,
  filterMcpServerCustomizations,
  loadMcpTools,
  loadWorkFlowTools,
  loadAppDefaultTools,
  convertToSavePart,
  sanitizeUIMessagesForConversion,
} from "./shared.chat";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "./actions";
import { getSession } from "auth/server";
import { colorize } from "consola/utils";
import { generateUUID } from "lib/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Chat API: `),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const session = await getSession();

    if (!session?.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    const {
      id,
      message,
      chatModel,
      toolChoice,
      allowedAppDefaultToolkit,
      allowedMcpServers,
      mentions = [],
    } = chatApiSchemaRequestBodySchema.parse(json);

    const model = customModelProvider.getModel(chatModel);

    let thread = await chatRepository.selectThreadDetails(id);

    if (!thread) {
      logger.info(`create chat thread: ${id}`);
      const newThread = await chatRepository.insertThread({
        id,
        title: "",
        userId: session.user.id,
      });
      thread = await chatRepository.selectThreadDetails(newThread.id);
    }

    if (thread!.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    const messages: UIMessage[] = (thread?.messages ?? []).map((m) => {
      return {
        id: m.id,
        role: m.role,
        parts: m.parts,
        metadata: m.metadata,
      };
    });

    if (messages.at(-1)?.id == message.id) {
      messages.pop();
    }
    messages.push(message);

    const supportToolCall = !isToolCallUnsupportedModel(model);

    const agentId = mentions.find((m) => m.type === "agent")?.agentId;

    const agent = await rememberAgentAction(agentId, session.user.id);

    if (agent?.instructions?.mentions) {
      mentions.push(...agent.instructions.mentions);
    }

    const isToolCallAllowed =
      supportToolCall && (toolChoice != "none" || mentions.length > 0);

    const metadata: ChatMetadata = {
      agentId: agent?.id,
      toolChoice: toolChoice,
      toolCount: 0,
      chatModel: chatModel,
    };

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const mcpClients = await mcpClientsManager.getClients();
        const mcpTools = await mcpClientsManager.tools();
        logger.info(
          `mcp-server count: ${mcpClients.length}, mcp-tools count :${Object.keys(mcpTools).length}`,
        );
        const MCP_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadMcpTools({
              mentions,
              allowedMcpServers,
            }),
          )
          .orElse({});

        const WORKFLOW_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadWorkFlowTools({
              mentions,
              dataStream,
            }),
          )
          .orElse({});

        const APP_DEFAULT_TOOLS = await safe()
          .map(errorIf(() => !isToolCallAllowed && "Not allowed"))
          .map(() =>
            loadAppDefaultTools({
              mentions,
              allowedAppDefaultToolkit,
            }),
          )
          .orElse({});
        const inProgressToolParts = extractInProgressToolPart(message);
        if (inProgressToolParts.length) {
          await Promise.all(
            inProgressToolParts.map(async (part) => {
              const output = await manualToolExecuteByLastMessage(
                part,
                { ...MCP_TOOLS, ...WORKFLOW_TOOLS, ...APP_DEFAULT_TOOLS },
                request.signal,
              );
              part.output = output;

              dataStream.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output,
              });
            }),
          );
        }

        const userPreferences = thread?.userPreferences || undefined;

        const mcpServerCustomizations = await safe()
          .map(() => {
            if (Object.keys(MCP_TOOLS ?? {}).length === 0)
              throw new Error("No tools found");
            return rememberMcpServerCustomizationsAction(session.user.id);
          })
          .map((v) => filterMcpServerCustomizations(MCP_TOOLS!, v))
          .orElse({});

        const systemPrompt = mergeSystemPrompt(
          buildUserSystemPrompt(session.user, userPreferences, agent),
          buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
          !supportToolCall && buildToolCallUnsupportedModelSystemPrompt,
        );

        const vercelAITooles = safe({ ...MCP_TOOLS, ...WORKFLOW_TOOLS })
          .map((t) => {
            const bindingTools =
              toolChoice === "manual" ||
              (message.metadata as ChatMetadata)?.toolChoice === "manual"
                ? excludeToolExecution(t)
                : t;
            return {
              ...bindingTools,
              ...APP_DEFAULT_TOOLS, // APP_DEFAULT_TOOLS Not Supported Manual
            };
          })
          .unwrap();
        metadata.toolCount = Object.keys(vercelAITooles).length;

        const allowedMcpTools = Object.values(allowedMcpServers ?? {})
          .map((t) => t.tools)
          .flat();

        logger.info(
          `${agent ? `agent: ${agent.name}, ` : ""}tool mode: ${toolChoice}, mentions: ${mentions.length}`,
        );

        logger.info(
          `allowedMcpTools: ${allowedMcpTools.length ?? 0}, allowedAppDefaultToolkit: ${allowedAppDefaultToolkit?.length ?? 0}`,
        );
        logger.info(
          `binding tool count APP_DEFAULT: ${Object.keys(APP_DEFAULT_TOOLS ?? {}).length}, MCP: ${Object.keys(MCP_TOOLS ?? {}).length}, Workflow: ${Object.keys(WORKFLOW_TOOLS ?? {}).length}`,
        );
        logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);

        // Sanitize messages before conversion to ensure proper format for AI SDK
        const sanitizedMessages =
          await sanitizeUIMessagesForConversion(messages);
        logger.info(`Sanitized ${messages.length} messages for conversion`);

        // Log file attachments for debugging
        const fileAttachments = sanitizedMessages
          .flatMap((msg) => msg.parts || [])
          .filter(
            (part) =>
              (part as any).type === "file" || (part as any).type === "image",
          );

        if (fileAttachments.length > 0) {
          logger.info(
            `Processing ${fileAttachments.length} file attachments:`,
            fileAttachments.map((part) => ({
              type: part.type,
              mediaType: (part as any).mediaType,
              hasData: !!(part as any).data,
              hasImage: !!(part as any).image,
              hasUrl: !!(part as any).url,
              name: (part as any).name,
            })),
          );
        }

        // Convert messages to model format with enhanced error handling
        let modelMessages;
        try {
          // Pre-conversion validation logging
          logger.info(
            `Converting ${sanitizedMessages.length} messages to model format`,
          );

          // Detailed validation of message structure for AI SDK compatibility
          const validationErrors: string[] = [];
          sanitizedMessages.forEach((msg, msgIndex) => {
            // Validate message structure
            if (!msg.role) {
              validationErrors.push(`Message ${msgIndex}: missing role`);
            }
            if (!msg.parts || !Array.isArray(msg.parts)) {
              validationErrors.push(
                `Message ${msgIndex}: missing or invalid parts array`,
              );
              return;
            }

            msg.parts.forEach((part, partIndex) => {
              const partAny = part as any;
              if (!partAny.type) {
                validationErrors.push(
                  `Message ${msgIndex}.part[${partIndex}]: missing type`,
                );
                return;
              }

              // Validate specific part types
              if (partAny.type === "text") {
                if (!partAny.text || typeof partAny.text !== "string") {
                  validationErrors.push(
                    `Message ${msgIndex}.part[${partIndex}]: text part missing or invalid text property`,
                  );
                }
              } else if ((partAny as any).type === "image") {
                if (!partAny.image || typeof partAny.image !== "string") {
                  validationErrors.push(
                    `Message ${msgIndex}.part[${partIndex}]: image part missing or invalid image property`,
                  );
                }
              } else if (partAny.type === "file") {
                if (!partAny.data || typeof partAny.data !== "string") {
                  validationErrors.push(
                    `Message ${msgIndex}.part[${partIndex}]: file part missing or invalid data property`,
                  );
                }
                if (
                  !partAny.mediaType ||
                  typeof partAny.mediaType !== "string"
                ) {
                  validationErrors.push(
                    `Message ${msgIndex}.part[${partIndex}]: file part missing or invalid mediaType property`,
                  );
                }
                if (!partAny.name || typeof partAny.name !== "string") {
                  validationErrors.push(
                    `Message ${msgIndex}.part[${partIndex}]: file part missing or invalid name property`,
                  );
                }
              }
            });
          });

          if (validationErrors.length > 0) {
            logger.error("Message validation errors before conversion:");
            validationErrors.forEach((error) => logger.error(`  - ${error}`));
          } else {
            logger.info("All messages passed validation checks");
          }

          // Log complete message structure for debugging
          logger.info("Complete message structure before conversion:");
          sanitizedMessages.forEach((msg, index) => {
            logger.info(
              `Message ${index}:`,
              JSON.stringify(
                {
                  role: msg.role,
                  id: msg.id,
                  parts: msg.parts?.map((part) => ({
                    type: part.type,
                    ...(part.type === "text" && {
                      text: (part as any).text?.substring(0, 100) + "...",
                    }),
                    ...((part as any).type === "image" && {
                      image:
                        typeof (part as any).image === "string"
                          ? `${(part as any).image.substring(0, 50)}...`
                          : "invalid",
                    }),
                    ...(part.type === "file" && {
                      mediaType: (part as any).mediaType,
                      name: (part as any).name,
                      dataLength:
                        typeof (part as any).data === "string"
                          ? (part as any).data.length
                          : "invalid",
                    }),
                  })),
                },
                null,
                2,
              ),
            );
          });

          modelMessages = convertToModelMessages(sanitizedMessages);
          logger.info(
            `Successfully converted ${modelMessages.length} messages to model format`,
          );
        } catch (conversionError) {
          logger.error("CONVERSION FAILED - Detailed error info:");
          logger.error("Error:", conversionError);

          // Log each message's parts structure for debugging
          sanitizedMessages.forEach((msg, index) => {
            if (msg.parts && msg.parts.length > 0) {
              logger.error(
                `Message ${index} parts structure:`,
                JSON.stringify(msg.parts, null, 2),
              );
            }
          });

          // Test with minimal message structure first
          logger.info("Testing with minimal message structure...");
          try {
            const testMessage: UIMessage[] = [
              {
                id: "test-id",
                role: "user",
                parts: [{ type: "text", text: "test" }],
              },
            ];
            convertToModelMessages(testMessage);
            logger.info(
              "Minimal message conversion succeeded - issue is with sanitized messages",
            );
          } catch (testError) {
            logger.error("Even minimal message conversion failed:", testError);
          }

          // Attempt fallback: remove all non-text parts and retry
          logger.info(
            "Attempting fallback conversion with text-only messages...",
          );
          try {
            const fallbackMessages = sanitizedMessages
              .map((msg) => {
                const textParts =
                  msg.parts?.filter((part) => part.type === "text") || [];

                // Ensure we have at least some text content
                if (textParts.length === 0) {
                  textParts.push({ type: "text", text: "Hello" }); // Minimal fallback content
                }

                return {
                  role: msg.role,
                  parts: textParts,
                };
              })
              .filter((msg) => msg.parts.length > 0); // Only keep messages with parts

            logger.info(
              `Fallback messages structure:`,
              JSON.stringify(fallbackMessages, null, 2),
            );

            modelMessages = convertToModelMessages(fallbackMessages);
            logger.warn(
              "Fallback conversion succeeded - continuing without file attachments",
            );

            // Notify about missing attachments in the response
            dataStream.write({
              type: "error",
              errorText:
                "File attachments were removed due to processing issues. Please try uploading the files again or contact support.",
            });
          } catch (fallbackError) {
            logger.error("Fallback conversion also failed:", fallbackError);
            logger.error(
              "Fallback error details:",
              JSON.stringify(
                {
                  error:
                    fallbackError instanceof Error
                      ? fallbackError.message
                      : fallbackError,
                  stack:
                    fallbackError instanceof Error
                      ? fallbackError.stack
                      : undefined,
                },
                null,
                2,
              ),
            );

            throw new Error(
              `All message conversion attempts failed. Original error: ${conversionError instanceof Error ? conversionError.message : "Unknown error"}`,
            );
          }
        }

        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          experimental_transform: smoothStream({ chunking: "word" }),
          maxRetries: 2,
          tools: vercelAITooles,
          stopWhen: stepCountIs(10),
          toolChoice: "auto",
          abortSignal: request.signal,
        });
        result.consumeStream();
        dataStream.merge(
          result.toUIMessageStream({
            messageMetadata: ({ part }) => {
              if (part.type == "finish") {
                metadata.usage = part.totalUsage;
                return metadata;
              }
            },
          }),
        );
      },

      generateId: generateUUID,
      onFinish: async ({ responseMessage }) => {
        if (responseMessage.id == message.id) {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            ...responseMessage,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        } else {
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: message.role,
            parts: message.parts.map(convertToSavePart),
            id: message.id,
          });
          await chatRepository.upsertMessage({
            threadId: thread!.id,
            role: responseMessage.role,
            id: responseMessage.id,
            parts: responseMessage.parts.map(convertToSavePart),
            metadata,
          });
        }

        if (agent) {
          agentRepository.updateAgent(agent.id, session.user.id, {
            updatedAt: new Date(),
          } as any);
        }
      },
      onError: handleError,
      originalMessages: messages,
    });

    return createUIMessageStreamResponse({
      stream,
    });
  } catch (error: any) {
    logger.error(error);
    return Response.json({ message: error.message }, { status: 500 });
  }
}

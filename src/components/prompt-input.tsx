"use client";

import {
  AudioWaveformIcon,
  ChevronDown,
  CornerRightUp,
  PlusIcon,
  Square,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "ui/button";
import { UIMessage, UseChatHelpers } from "@ai-sdk/react";
import { SelectModel } from "./select-model";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { ChatMention, ChatModel, FileAttachment } from "app-types/chat";
import { FileUpload } from "./file-upload";
import { FileAttachmentDisplay } from "./file-attachment";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "ui/dialog";
import dynamic from "next/dynamic";
import { ToolModeDropdown } from "./tool-mode-dropdown";

import { ToolSelectDropdown } from "./tool-select-dropdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useTranslations } from "next-intl";
import { Editor } from "@tiptap/react";
import { WorkflowSummary } from "app-types/workflow";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import equal from "lib/equal";
import { MCPIcon } from "ui/mcp-icon";
import { DefaultToolName } from "lib/ai/tools";
import { DefaultToolIcon } from "./default-tool-icon";
import { OpenAIIcon } from "ui/openai-icon";
import { GrokIcon } from "ui/grok-icon";
import { ClaudeIcon } from "ui/claude-icon";
import { GeminiIcon } from "ui/gemini-icon";

import { EMOJI_DATA } from "lib/const";
import { AgentSummary } from "app-types/agent";

interface PromptInputProps {
  placeholder?: string;
  setInput: (value: string) => void;
  input: string;
  onStop: () => void;
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  toolDisabled?: boolean;
  isLoading?: boolean;
  model?: ChatModel;
  setModel?: (model: ChatModel) => void;
  voiceDisabled?: boolean;
  threadId?: string;
  disabledMention?: boolean;
  onFocus?: () => void;
}

const ChatMentionInput = dynamic(() => import("./chat-mention-input"), {
  ssr: false,
  loading() {
    return <div className="h-[2rem] w-full animate-pulse"></div>;
  },
});

export default function PromptInput({
  placeholder,
  sendMessage,
  model,
  setModel,
  input,
  onFocus,
  setInput,
  onStop,
  isLoading,
  toolDisabled,
  voiceDisabled,
  threadId,
  disabledMention,
}: PromptInputProps) {
  const t = useTranslations("Chat");

  const [globalModel, threadMentions, appStoreMutate] = appStore(
    useShallow((state) => [
      state.chatModel,
      state.threadMentions,
      state.mutate,
    ]),
  );

  // File upload state
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([]);
  const [isFileUploadOpen, setIsFileUploadOpen] = useState(false);

  const mentions = useMemo<ChatMention[]>(() => {
    if (!threadId) return [];
    return threadMentions[threadId!] ?? [];
  }, [threadMentions, threadId]);

  const chatModel = useMemo(() => {
    return model ?? globalModel;
  }, [model, globalModel]);

  const editorRef = useRef<Editor | null>(null);

  const setChatModel = useCallback(
    (model: ChatModel) => {
      if (setModel) {
        setModel(model);
      } else {
        appStoreMutate({ chatModel: model });
      }
    },
    [setModel, appStoreMutate],
  );

  const deleteMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      appStoreMutate((prev) => {
        const newMentions = mentions.filter((m) => !equal(m, mention));
        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: newMentions,
          },
        };
      });
    },
    [mentions, threadId],
  );

  const addMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      appStoreMutate((prev) => {
        if (mentions.some((m) => equal(m, mention))) return prev;

        const newMentions =
          mention.type == "agent"
            ? [...mentions.filter((m) => m.type !== "agent"), mention]
            : [...mentions, mention];

        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: newMentions,
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onSelectWorkflow = useCallback(
    (workflow: WorkflowSummary) => {
      addMention({
        type: "workflow",
        name: workflow.name,
        icon: workflow.icon,
        workflowId: workflow.id,
        description: workflow.description,
      });
    },
    [addMention],
  );

  const onSelectAgent = useCallback(
    (agent: AgentSummary) => {
      appStoreMutate((prev) => {
        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: [
              {
                type: "agent",
                name: agent.name,
                icon: agent.icon,
                description: agent.description,
                agentId: agent.id,
              },
            ],
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onChangeMention = useCallback(
    (mentions: ChatMention[]) => {
      let hasAgent = false;
      [...mentions]
        .reverse()
        .filter((m) => {
          if (m.type == "agent") {
            if (hasAgent) return false;
            hasAgent = true;
          }

          return true;
        })
        .reverse()
        .forEach(addMention);
    },
    [addMention],
  );

  const handleFilesSelected = useCallback((files: FileAttachment[]) => {
    setSelectedFiles(files);
  }, []);

  const handleRemoveFile = useCallback((fileId: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const submit = async () => {
    if (isLoading) return;
    const userMessage = input?.trim() || "";
    if (userMessage.length === 0 && selectedFiles.length === 0) return;

    // Create message parts array
    const parts: any[] = [];

    // Add text part if there's text input
    if (userMessage.length > 0) {
      parts.push({
        type: "text",
        text: userMessage,
      });
    }

    // Add file attachment parts with improved validation and error handling
    for (const file of selectedFiles) {
      // Enhanced validation of file properties
      if (!file.url || !file.type || !file.originalName) {
        console.warn(
          "Skipping invalid file attachment - missing required properties:",
          {
            hasUrl: !!file.url,
            hasType: !!file.type,
            hasOriginalName: !!file.originalName,
            file,
          },
        );
        continue;
      }

      // Validate file type is a proper MIME type
      if (typeof file.type !== "string" || !file.type.includes("/")) {
        console.warn("Skipping file with invalid MIME type:", file.type);
        continue;
      }

      try {
        if (file.type.startsWith("image/")) {
          // For images, use the image property with URL
          const imagePart = {
            type: "image" as const,
            image: file.url,
          };

          // Validate the image part structure
          if (
            typeof imagePart.image !== "string" ||
            imagePart.image.length === 0
          ) {
            console.error(
              "Invalid image part structure for:",
              file.originalName,
            );
            continue;
          }

          parts.push(imagePart);
          console.log("Added image part for:", file.originalName);
        } else {
          // For non-image files, fetch the actual content
          console.log(
            "Fetching content for file:",
            file.originalName,
            "type:",
            file.type,
          );

          const response = await fetch(file.url);
          if (!response.ok) {
            console.error(
              `Failed to fetch file content for ${file.originalName}: ${response.status} ${response.statusText}`,
            );
            continue;
          }

          // Handle different file types appropriately
          let fileData: string;
          const isTextFile =
            file.type.startsWith("text/") ||
            file.type === "application/json" ||
            file.type === "text/csv" ||
            file.type === "text/markdown" ||
            file.type === "application/javascript" ||
            file.type === "application/typescript";

          if (isTextFile) {
            // For text-based files, get as text
            fileData = await response.text();
            console.log(
              `Fetched text content for ${file.originalName}, length: ${fileData.length}`,
            );
          } else {
            // For binary files, convert to base64
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            fileData = btoa(
              String.fromCharCode.apply(null, Array.from(uint8Array)),
            );
            console.log(
              `Converted binary content to base64 for ${file.originalName}, length: ${fileData.length}`,
            );
          }

          // Validate the data was successfully retrieved
          if (!fileData || fileData.length === 0) {
            console.error(
              `No content retrieved for file: ${file.originalName}`,
            );
            continue;
          }

          // Create the file part with all required properties
          const filePart = {
            type: "file" as const,
            data: fileData,
            mediaType: file.type,
            name: file.originalName,
          };

          // Final validation of the file part structure
          if (
            !filePart.data ||
            typeof filePart.data !== "string" ||
            !filePart.mediaType ||
            typeof filePart.mediaType !== "string" ||
            !filePart.name ||
            typeof filePart.name !== "string"
          ) {
            console.error(
              "Invalid file part structure created for:",
              file.originalName,
              filePart,
            );
            continue;
          }

          parts.push(filePart);
          console.log("Successfully added file part for:", file.originalName, {
            mediaType: filePart.mediaType,
            name: filePart.name,
            dataLength: filePart.data.length,
          });
        }
      } catch (error) {
        console.error(`Error processing file ${file.originalName}:`, error);
        // Log additional context for debugging
        console.error("File details:", {
          id: file.id,
          originalName: file.originalName,
          type: file.type,
          size: file.size,
          url: file.url,
        });
        // Skip this file but continue with others
        continue;
      }
    }

    setInput("");
    setSelectedFiles([]);
    sendMessage({
      role: "user",
      parts,
    });
  };

  // Handle ESC key to clear mentions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mentions.length > 0 && threadId) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate((prev) => ({
          threadMentions: {
            ...prev.threadMentions,
            [threadId]: [],
          },
          agentId: undefined,
        }));
        editorRef.current?.commands.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mentions.length, threadId, appStoreMutate]);

  useEffect(() => {
    if (!editorRef.current) return;
  }, [editorRef.current]);

  return (
    <div className="max-w-3xl mx-auto fade-in animate-in">
      <div className="z-10 mx-auto w-full max-w-3xl relative">
        <fieldset className="flex w-full min-w-0 max-w-full flex-col px-4">
          <div className="shadow-lg overflow-hidden rounded-4xl backdrop-blur-sm transition-all duration-200 bg-muted/60 relative flex w-full flex-col cursor-text z-10 items-stretch focus-within:bg-muted hover:bg-muted focus-within:ring-muted hover:ring-muted">
            {mentions.length > 0 && (
              <div className="bg-input rounded-b-sm rounded-t-3xl p-3 flex flex-col gap-4 mx-2 my-2">
                {mentions.map((mention, i) => {
                  return (
                    <div key={i} className="flex items-center gap-2">
                      {mention.type === "workflow" ||
                      mention.type === "agent" ? (
                        <Avatar
                          className="size-6 p-1 ring ring-border rounded-full flex-shrink-0"
                          style={mention.icon?.style}
                        >
                          <AvatarImage
                            src={
                              mention.icon?.value ||
                              EMOJI_DATA[i % EMOJI_DATA.length]
                            }
                          />
                          <AvatarFallback>
                            {mention.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <Button className="size-6 flex items-center justify-center ring ring-border rounded-full flex-shrink-0 p-0.5">
                          {mention.type == "mcpServer" ? (
                            <MCPIcon className="size-3.5" />
                          ) : (
                            <DefaultToolIcon
                              name={mention.name as DefaultToolName}
                              className="size-3.5"
                            />
                          )}
                        </Button>
                      )}

                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {mention.name}
                        </span>
                        {mention.description ? (
                          <span className="text-muted-foreground text-xs truncate">
                            {mention.description}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        disabled={!threadId}
                        className="rounded-full hover:bg-input! flex-shrink-0"
                        onClick={() => {
                          deleteMention(mention);
                        }}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected Files Display */}
            {selectedFiles.length > 0 && (
              <div className="bg-input/40 rounded-b-sm rounded-t-3xl p-3 mx-2 mb-2 space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  Attached Files ({selectedFiles.length})
                </div>
                <div className="grid gap-2">
                  {selectedFiles.map((file) => (
                    <FileAttachmentDisplay
                      key={file.id}
                      file={file}
                      showPreview={false}
                      className="bg-background"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3.5 px-5 pt-2 pb-4">
              <div className="relative min-h-[2rem]">
                <ChatMentionInput
                  input={input}
                  onChange={setInput}
                  onChangeMention={onChangeMention}
                  onEnter={submit}
                  placeholder={placeholder ?? t("placeholder")}
                  ref={editorRef}
                  disabledMention={disabledMention}
                  onFocus={onFocus}
                />
              </div>
              <div className="flex w-full items-center z-30">
                <Button
                  variant={"ghost"}
                  size={"sm"}
                  className="rounded-full hover:bg-input! p-2!"
                  onClick={() => setIsFileUploadOpen(true)}
                >
                  <PlusIcon />
                </Button>

                {!toolDisabled && (
                  <>
                    <ToolModeDropdown />
                    <ToolSelectDropdown
                      className="mx-1"
                      align="start"
                      side="top"
                      onSelectWorkflow={onSelectWorkflow}
                      onSelectAgent={onSelectAgent}
                      mentions={mentions}
                    />
                  </>
                )}

                <div className="flex-1" />

                <SelectModel onSelect={setChatModel} currentModel={chatModel}>
                  <Button
                    variant={"ghost"}
                    size={"sm"}
                    className="rounded-full group data-[state=open]:bg-input! hover:bg-input! mr-1"
                    data-testid="model-selector-button"
                  >
                    {chatModel?.model ? (
                      <>
                        {chatModel.provider === "openai" ? (
                          <OpenAIIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "xai" ? (
                          <GrokIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "anthropic" ? (
                          <ClaudeIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : chatModel.provider === "google" ? (
                          <GeminiIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100" />
                        ) : null}
                        <span
                          className="text-foreground group-data-[state=open]:text-foreground  "
                          data-testid="selected-model-name"
                        >
                          {chatModel.model}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">model</span>
                    )}

                    <ChevronDown className="size-3" />
                  </Button>
                </SelectModel>
                {!isLoading && !input.length && !voiceDisabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size={"sm"}
                        onClick={() => {
                          appStoreMutate((state) => ({
                            voiceChat: {
                              ...state.voiceChat,
                              isOpen: true,
                              agentId: undefined,
                            },
                          }));
                        }}
                        className="rounded-full p-2!"
                      >
                        <AudioWaveformIcon size={16} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("VoiceChat.title")}</TooltipContent>
                  </Tooltip>
                ) : (
                  <div
                    onClick={() => {
                      if (isLoading) {
                        onStop();
                      } else {
                        submit();
                      }
                    }}
                    className="fade-in animate-in cursor-pointer text-muted-foreground rounded-full p-2 bg-secondary hover:bg-accent-foreground hover:text-accent transition-all duration-200"
                  >
                    {isLoading ? (
                      <Square
                        size={16}
                        className="fill-muted-foreground text-muted-foreground"
                      />
                    ) : (
                      <CornerRightUp size={16} />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </fieldset>
      </div>

      {/* File Upload Dialog */}
      <Dialog open={isFileUploadOpen} onOpenChange={setIsFileUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
          </DialogHeader>
          <FileUpload
            onFilesSelected={handleFilesSelected}
            selectedFiles={selectedFiles}
            onRemoveFile={handleRemoveFile}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

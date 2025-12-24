#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const server = new McpServer({
  name: "yuque-mcp",
  version: "1.0.0",
});

// Helper to get configuration
function getConfig(args: Record<string, any>) {
  const spaceSubdomain = process.env.YUQUE_SPACE_SUBDOMAIN || "";
  const apiToken = process.env.DEFAULT_API_TOKEN || "";
  const groupLogin = args.group_login || process.env.DEFAULT_GROUP_LOGIN || "";
  const bookSlug = args.book_slug || process.env.DEFAULT_BOOK_SLUG || "";

  return { spaceSubdomain, apiToken, groupLogin, bookSlug };
}

// Tool: get_yuque_doc_list
server.tool(
  "get_yuque_doc_list",
  "获取语雀知识库中的文档列表。支持分页。",
  {
    group_login: z.string().optional().describe("团队的 Login（唯一标识）"),
    book_slug: z.string().optional().describe("知识库的路径标识（slug）"),
    offset: z.number().optional().default(0).describe("分页偏移量"),
    limit: z.number().optional().default(100).describe("每页返回的文档数量"),
  },
  async (args) => {
    const { spaceSubdomain, apiToken, groupLogin, bookSlug } = getConfig(args);

    if (!apiToken || !groupLogin || !bookSlug) {
      return {
        content: [{ type: "text", text: "缺少必要的API_TOKEN、GROUP_LOGIN或BOOK_SLUG参数，请检查配置。" }],
      };
    }

    const url = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/docs`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          "X-Auth-Token": apiToken,
          "Content-Type": "application/json",
        },
        params: {
          offset: args.offset,
          limit: args.limit,
          optional_properties: "hits,tags,latest_version_id",
        },
      });

      const data = response.data.data || [];
      if (data.length === 0) {
        return { content: [{ type: "text", text: "文档列表为空。" }] };
      }

      let docListText = "文档列表:\n";
      for (const doc of data) {
        const title = doc.title || "无标题";
        const docId = doc.id || "";
        docListText += `- ${title} (ID: ${docId})\n`;
      }

      return { content: [{ type: "text", text: docListText }] };
    } catch (error: any) {
      const errorMessage = error.response
        ? `状态码: ${error.response.status}，信息: ${JSON.stringify(error.response.data)}`
        : error.message;
      return { content: [{ type: "text", text: `获取文档列表失败: ${errorMessage}` }] };
    }
  }
);

// Tool: create_yuque_doc_in_group
server.tool(
  "create_yuque_doc_in_group",
  "在指定的语雀知识库中的指定分组下创建一个文档。如果该分组不存在，则会先创建该分组。",
  {
    group_name: z.string().describe("分组名称"),
    doc_title: z.string().describe("文档标题"),
    doc_body: z.string().describe("文档内容 (Markdown)"),
    group_login: z.string().optional(),
    book_slug: z.string().optional(),
  },
  async (args) => {
    const { spaceSubdomain, apiToken, groupLogin, bookSlug } = getConfig(args);

    if (!apiToken || !groupLogin || !bookSlug) {
        return { content: [{ type: "text", text: "缺少必要的API_TOKEN、GROUP_LOGIN或BOOK_SLUG参数。" }] };
    }

    const headers = {
      "X-Auth-Token": apiToken,
      "Content-Type": "application/json",
    };

    try {
        // 1. Get TOC
        const urlToc = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/toc`;
        const tocResponse = await axios.get(urlToc, { headers });
        const tocList = tocResponse.data.data || [];

        // 2. Find group UUID
        let groupUuid = null;
        for (const node of tocList) {
            if (node.type === "TITLE" && node.title === args.group_name) {
                groupUuid = node.uuid;
                break;
            }
        }

        // 3. Create group if not exists
        if (!groupUuid) {
            const createGroupPayload = {
                action: "appendNode",
                action_mode: "child",
                type: "TITLE",
                title: args.group_name,
                visible: 1
            };
            const createGroupResponse = await axios.put(urlToc, createGroupPayload, { headers });
            const groupData = createGroupResponse.data.data;
            if (Array.isArray(groupData)) {
                groupUuid = groupData[groupData.length - 1]?.uuid;
            } else if (groupData) {
                groupUuid = groupData.uuid;
            }
            
            if (!groupUuid) {
                return { content: [{ type: "text", text: "创建分组失败，未获取到分组UUID。" }] };
            }
        }

        // 4. Create Doc
        const urlCreateDoc = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/docs`;
        const docPayload = {
            title: args.doc_title,
            body: args.doc_body,
            format: "markdown",
            public: 0
        };
        const createDocResponse = await axios.post(urlCreateDoc, docPayload, { headers });
        const docId = createDocResponse.data.data?.id;

        if (!docId) {
             return { content: [{ type: "text", text: "文档创建失败，未获取到文档ID。" }] };
        }

        // 5. Update TOC to add doc to group
        const updateTocPayload = {
            action: "appendNode",
            action_mode: "child",
            target_uuid: groupUuid,
            type: "DOC",
            doc_ids: [docId],
            visible: 1
        };
        await axios.put(urlToc, updateTocPayload, { headers });

        return { content: [{ type: "text", text: `文档 '${args.doc_title}' 创建成功并添加到分组 '${args.group_name}'。` }] };

    } catch (error: any) {
        const errorMessage = error.response
            ? `状态码: ${error.response.status}，信息: ${JSON.stringify(error.response.data)}`
            : error.message;
        return { content: [{ type: "text", text: `操作失败: ${errorMessage}` }] };
    }
  }
);

// Tool: create_yuque_group
server.tool(
  "create_yuque_group",
  "创建一个语雀知识库中的分组（目录）。",
  {
    name: z.string().describe("要创建的分组名称"),
    group_login: z.string().optional(),
    book_slug: z.string().optional(),
  },
  async (args) => {
    const { spaceSubdomain, apiToken, groupLogin, bookSlug } = getConfig(args);

    if (!apiToken || !groupLogin || !bookSlug) {
         return { content: [{ type: "text", text: "缺少必要的配置参数。" }] };
    }

    const url = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/toc`;
    const payload = {
        action: "appendNode",
        action_mode: "child",
        type: "TITLE",
        title: args.name,
        visible: 1
    };

    try {
        const response = await axios.put(url, payload, {
            headers: {
                "X-Auth-Token": apiToken,
                "Content-Type": "application/json"
            }
        });
        return { content: [{ type: "text", text: `分组节点 '${args.name}' 创建成功。` }] };
    } catch (error: any) {
         const errorMessage = error.response
            ? `状态码: ${error.response.status}，信息: ${JSON.stringify(error.response.data)}`
            : error.message;
        return { content: [{ type: "text", text: `创建分组失败: ${errorMessage}` }] };
    }
  }
);

// Tool: get_yuque_doc_detail
server.tool(
  "get_yuque_doc_detail",
  "获取语雀知识库中指定文档的详细信息。支持直接传入文档 URL 或 ID。",
  {
    doc_id: z.string().describe("文档 ID、Slug 或完整文档 URL (如 https://xxx.yuque.com/xxx/xxx/xxx)"),
    group_login: z.string().optional(),
    book_slug: z.string().optional(),
    page_size: z.number().optional().default(100),
    page: z.number().optional().default(1),
  },
  async (args) => {
    let { spaceSubdomain, apiToken, groupLogin, bookSlug } = getConfig(args);
    let docId = args.doc_id;

    // 尝试从 URL 中解析参数
    if (docId.startsWith("http")) {
      try {
        const urlObj = new URL(docId);
        const pathParts = urlObj.pathname.split("/").filter(Boolean);
        // 典型格式: /group_login/book_slug/doc_slug
        // 或者: /u123456/book_slug/doc_slug
        if (pathParts.length >= 3) {
            // 如果 URL 是 https://subdomain.yuque.com/group/book/doc
            // pathParts[0] = group, pathParts[1] = book, pathParts[2] = doc
            // 有些企业空间 URL 结构可能不同，这里适配标准结构
            
            // 覆盖配置
            spaceSubdomain = urlObj.hostname.split(".")[0]; // 获取子域名
            
            // 如果路径中包含 "org-wiki"，结构可能会有变化，这里简单处理标准结构
            // 假设最后一部分是 doc_slug
            docId = pathParts[pathParts.length - 1]; 
            
            // 倒数第二部分是 book_slug
            if (!bookSlug) bookSlug = pathParts[pathParts.length - 2];
            
            // 倒数第三部分是 group_login
            if (!groupLogin) groupLogin = pathParts[pathParts.length - 3];
        }
      } catch (e) {
        // 解析失败则按普通 ID 处理
        console.error("URL parsing failed:", e);
      }
    }

    if (!apiToken || !groupLogin || !bookSlug || !docId) {
        return { content: [{ type: "text", text: "缺少必要的API_TOKEN、GROUP_LOGIN、BOOK_SLUG或文档ID参数，或无法从 URL 解析。" }] };
    }

    const url = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/docs/${docId}`;
    
    try {
        const response = await axios.get(url, {
            headers: { "X-Auth-Token": apiToken, "Content-Type": "application/json" },
            params: { page_size: args.page_size, page: args.page }
        });
        
        const data = response.data.data;
        if (!data) {
             return { content: [{ type: "text", text: "未找到文档详情。" }] };
        }

        const detailText = `文档详情:\n标题: ${data.title || ''}\nID: ${data.id || ''}\n描述: ${data.description || ''}\n创建时间: ${data.created_at || ''}\n更新时间: ${data.updated_at || ''}\n阅读数: ${data.read_count ?? 'N/A'}\n点赞数: ${data.likes_count ?? 'N/A'}\n评论数: ${data.comments_count ?? 'N/A'}\n内容:\n${data.body || ''}`;
        
        return { content: [{ type: "text", text: detailText }] };

    } catch (error: any) {
        const errorMessage = error.response
            ? `状态码: ${error.response.status}，信息: ${JSON.stringify(error.response.data)}`
            : error.message;
        return { content: [{ type: "text", text: `获取文档详情失败: ${errorMessage}` }] };
    }
  }
);

// Tool: get_yuque_repo_toc
server.tool(
  "get_yuque_repo_toc",
  "获取语雀知识库的完整目录结构。",
  {
    group_login: z.string().optional(),
    book_slug: z.string().optional(),
  },
  async (args) => {
    const { spaceSubdomain, apiToken, groupLogin, bookSlug } = getConfig(args);
     if (!apiToken || !groupLogin || !bookSlug) {
         return { content: [{ type: "text", text: "缺少必要的配置参数。" }] };
    }

    const url = `https://${spaceSubdomain}.yuque.com/api/v2/repos/${groupLogin}/${bookSlug}/toc`;
    
    try {
        const response = await axios.get(url, {
            headers: { "X-Auth-Token": apiToken }
        });
        
        return { content: [{ type: "text", text: `目录获取成功: ${JSON.stringify(response.data, null, 2)}` }] };
    } catch (error: any) {
        const errorMessage = error.response
            ? `状态码: ${error.response.status}，信息: ${JSON.stringify(error.response.data)}`
            : error.message;
        return { content: [{ type: "text", text: `获取目录失败: ${errorMessage}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Yuque MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});


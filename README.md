# Yuque MCP Server (Node.js)

Node.js implementation of the Yuque MCP server.

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Build:
    ```bash
    npm run build
    ```

## Configuration

Set the following environment variables (create a `.env` file or pass them when running):

- `YUQUE_SPACE_SUBDOMAIN`: Your Yuque space subdomain (e.g., `yourteam`).
- `DEFAULT_API_TOKEN`: Your Yuque API Token.
- `DEFAULT_GROUP_LOGIN`: Default group/team login.
- `DEFAULT_BOOK_SLUG`: Default knowledge base slug.

## Usage

Run the server with Stdio transport:

```bash
npm start
```

Or for development:

```bash
npm run dev
```

## Tools

- `get_yuque_doc_list`: Get document list.
- `create_yuque_doc_in_group`: Create a document in a group (creates group if needed).
- `create_yuque_group`: Create a group.
- `get_yuque_doc_detail`: Get document details.
- `get_yuque_repo_toc`: Get knowledge base table of contents.


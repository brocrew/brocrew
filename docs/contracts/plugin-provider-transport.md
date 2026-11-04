# Managed plugin provider transport

Managed routes use the existing provider attachment API. Claude receives HTTP `headers`; Codex receives per-thread `http_headers`. A provider route belongs to one workspace and one actual running plugin instance. The private downstream client stays in the supervisor; provider configuration contains only its loopback route and route-local bearer.

`openManagedPluginRoute` serves MCP tools/list and tools/call. Inventory comes from the retained instance client's current paginated MCP inventory. Schemas, annotations, titles and metadata pass through. Names that violate provider syntax are encoded generically and reversed at dispatch; no plugin name or tool inventory is compiled into the adapter. A namespace collision can be resolved by assigning another provider namespace without changing plugin identity or arguments.

Calls use the same generic broker as settings, button, notification and turn callbacks. The app forwards arguments unchanged and carries workspace, request and origin in MCP `_meta`. MCP content, structured content, `isError` and metadata return unchanged. Remote MCP error code, message and data pass through faithfully, including inventory errors. The relay removes only the SDK display prefix before serializing the next wire response. Actual transport failures are separate MCP error responses, never synthetic successful content or a collapsed tool result. No destructive call is retried.

The route authenticates its local routing identity before handling a request. Its workspace switch and instance lifetime remain current on every request. Closing one route cancels that route's active requests and closes its HTTP exchanges; it neither closes the retained plugin client nor revokes other routes. MCP cancellation notifications target only their active request ID. A failed cancellation does not permanently deny the plugin.

The streamed surface is MCP Streamable HTTP/SSE replies followed by each provider's ordinary model streaming. This adapter adds no incremental tool-content or progress API. Existing runtime attachment refresh and provider readiness behavior is unchanged.

Controlled tests exercise both provider configuration builders against the real loopback route and an inert MCP server. They cover exact mixed results, changed tools/schemas, reversible naming, cancellation, workspace isolation, route retirement and transport errors. They do not establish a native provider session, a packaged app journey or real account behavior.

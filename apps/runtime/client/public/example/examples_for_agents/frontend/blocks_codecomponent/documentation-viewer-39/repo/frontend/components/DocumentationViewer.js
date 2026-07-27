import{React as s,useModel as I,useNavigation as N,useTheme as R,toast as D,Accordion as M,AccordionItem as G,AccordionTrigger as z,AccordionContent as T,Breadcrumb as q,BreadcrumbList as E,BreadcrumbItem as k,BreadcrumbLink as x,BreadcrumbPage as L,BreadcrumbSeparator as O,Card as F,CardContent as H,Button as K,ScrollArea as v,Icons as P,cn as w}from"@exepad/sdk";import*as i from"@exepad/ext-highlight";import*as A from"@exepad/ext-markdown";var l=window.React,e=(n,c,u)=>{let{children:o,...m}=c||{},d=u!==void 0?{...m,key:u}:m;return Array.isArray(o)?l.createElement.apply(l,[n,d].concat(o)):l.createElement(n,d,o)},r=e;var Q=l.Fragment;var g=[{id:"getting-started",title:"Getting Started",category:"Getting Started",content:`# Getting Started

Welcome to the API documentation. This guide will help you set up your development environment and make your first API call.

## Installation

Install the SDK using your preferred package manager:

\`\`\`bash
npm install @example/sdk
\`\`\`

Or with yarn:

\`\`\`bash
yarn add @example/sdk
\`\`\`

## Quick Start

Initialize the client with your API key:

\`\`\`javascript
import { Client } from '@example/sdk';

const client = new Client({
  apiKey: process.env.API_KEY,
  region: 'us-east-1',
});

const result = await client.query({ table: 'users', limit: 10 });
console.log(result.data);
\`\`\`

## Authentication

All API requests require a valid API key. You can generate one from your dashboard under **Settings > API Keys**.
`},{id:"api-reference",title:"API Reference",category:"API Reference",content:`# API Reference

## Client

The main entry point for interacting with the API.

### Constructor

\`\`\`typescript
interface ClientOptions {
  apiKey: string;
  region?: string;
  timeout?: number;
  retries?: number;
}

const client = new Client(options: ClientOptions);
\`\`\`

### Methods

#### \`query(params)\`

Execute a query against your data.

\`\`\`typescript
interface QueryParams {
  table: string;
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

const result = await client.query(params: QueryParams);
\`\`\`

#### \`mutate(params)\`

Insert, update, or delete records.

\`\`\`typescript
interface MutateParams {
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
}

const result = await client.mutate(params: MutateParams);
\`\`\`

## Response Format

All responses follow a consistent shape:

\`\`\`json
{
  "data": [],
  "meta": { "total": 100, "page": 1 },
  "error": null
}
\`\`\`
`},{id:"guides-pagination",title:"Pagination Guide",category:"Guides",content:`# Pagination Guide

Learn how to paginate through large datasets efficiently.

## Offset-Based Pagination

The simplest approach uses \`limit\` and \`offset\`:

\`\`\`typescript
async function fetchPage(page: number, pageSize: number = 20) {
  const result = await client.query({
    table: 'products',
    limit: pageSize,
    offset: (page - 1) * pageSize,
    orderBy: 'created_at DESC',
  });

  return {
    items: result.data,
    totalPages: Math.ceil(result.meta.total / pageSize),
    currentPage: page,
  };
}
\`\`\`

## Cursor-Based Pagination

For better performance with large datasets, use cursor-based pagination:

\`\`\`typescript
async function fetchNextPage(cursor?: string) {
  const result = await client.query({
    table: 'events',
    limit: 50,
    after: cursor,
    orderBy: 'id ASC',
  });

  return {
    items: result.data,
    nextCursor: result.meta.nextCursor,
    hasMore: result.meta.hasMore,
  };
}
\`\`\`

## Best Practices

- Use cursor-based pagination for real-time data
- Cache page results when possible
- Set reasonable page sizes (20-100 items)
`}],C=[{category:"Getting Started",items:[{id:"getting-started",title:"Getting Started"}]},{category:"API Reference",items:[{id:"api-reference",title:"API Reference"}]},{category:"Guides",items:[{id:"guides-pagination",title:"Pagination Guide"}]}];function j(){let[n,c]=s.useState("getting-started"),u=N(),o=R(),m=I(),d=g.find(t=>t.id===n)??g[0],p=o?.resolvedTheme==="dark",y=s.useMemo(()=>{let t=g.find(a=>a.id===n);return t?[t.category,t.title]:[]},[n]),f=s.useCallback(t=>{navigator.clipboard.writeText(t).then(()=>{D.success("Code copied to clipboard!")})},[]),S=s.useCallback(({className:t,children:a,...B})=>{let h=/language-(\w+)/.exec(t||""),b=String(a).replace(/\n$/,"");return h?r("div",{className:"relative group my-4",children:[e("div",{className:"absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10",children:r(K,{variant:"ghost",size:"sm",onClick:()=>f(b),className:"h-7 px-2 text-xs",children:[e(P.Copy,{className:"h-3 w-3 mr-1"}),"Copy"]})}),e(i.default,{language:h[1],style:p?i.oneDark:i.oneLight,customStyle:{borderRadius:"0.5rem",padding:"1rem",fontSize:"0.875rem"},children:b})]}):e("code",{className:w("bg-muted px-1.5 py-0.5 rounded text-sm font-mono",t),...B,children:a})},[p,f]);return r("div",{className:"flex gap-6 min-h-[600px]",children:[e("div",{className:"w-64 shrink-0",children:e(v,{className:"h-[600px]",children:r("div",{className:"pr-4 space-y-1",children:[r("h3",{className:"font-semibold text-sm mb-3 flex items-center gap-2",children:[e(P.BookOpen,{className:"h-4 w-4 text-sky-600"}),"Documentation"]}),e(M,{type:"multiple",defaultValue:C.map(t=>t.category),children:C.map(t=>r(G,{value:t.category,children:[e(z,{className:"text-sm py-2",children:t.category}),e(T,{children:e("div",{className:"space-y-1 pl-2",children:t.items.map(a=>e("button",{onClick:()=>c(a.id),className:w("w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors",n===a.id?"bg-sky-100 text-sky-700 font-medium dark:bg-sky-900/30 dark:text-sky-300":"text-muted-foreground hover:bg-muted hover:text-foreground"),children:a.title},a.id))})})]},t.category))})]})})}),r("div",{className:"flex-1 min-w-0",children:[e(q,{className:"mb-4",children:r(E,{children:[e(k,{children:e(x,{onClick:()=>c("getting-started"),children:"Docs"})}),y.map((t,a)=>r(s.Fragment,{children:[e(O,{}),e(k,{children:a===y.length-1?e(L,{children:t}):e(x,{children:t})})]},a))]})}),e(F,{children:e(H,{className:"pt-6",children:e(v,{className:"h-[540px] pr-4",children:e("div",{className:"prose prose-sm dark:prose-invert max-w-none",children:e(A.default,{components:{code:S},children:d.content})})})})})]})]})}var Y=j;export{Y as default};

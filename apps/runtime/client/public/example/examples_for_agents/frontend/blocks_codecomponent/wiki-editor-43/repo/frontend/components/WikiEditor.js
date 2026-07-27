import{React as u,useModel as q,useHandler as B,useAppState as H,toast as I,ScrollArea as F,AlertDialog as j,AlertDialogTrigger as z,AlertDialogContent as U,AlertDialogHeader as L,AlertDialogTitle as K,AlertDialogDescription as V,AlertDialogFooter as _,AlertDialogAction as J,AlertDialogCancel as Q,DropdownMenu as $,DropdownMenuTrigger as X,DropdownMenuContent as Y,DropdownMenuItem as D,Card as Z,CardContent as ee,Button as S,Badge as O,Separator as te,Icons as o,cn as A}from"@exepad/sdk";var y=window.React,t=(P,C,p)=>{let{children:f,...M}=C||{},b=p!==void 0?{...M,key:p}:M;return Array.isArray(f)?y.createElement.apply(y,[P,b].concat(f)):y.createElement(P,b,f)},n=t;var oe=y.Fragment;var ne=[{id:"w1",title:"Welcome to the Wiki",status:"published",lastModified:"2024-03-10",content:`# Welcome

This is the main wiki page. It serves as the entry point for all documentation.

## Quick Links

- Getting Started Guide
- API Documentation
- Architecture Overview
- Contributing Guidelines

> **Note:** This wiki is collaboratively edited. Please follow the style guide when making changes.`},{id:"w2",title:"Architecture Overview",status:"published",lastModified:"2024-03-08",content:`# Architecture Overview

The system follows a microservices architecture with the following components:

## Services

- **API Gateway** - Routes requests to appropriate services
- **Auth Service** - Handles authentication and authorization
- **Data Service** - Manages persistent storage
- **Notification Service** - Sends emails and push notifications

## Communication

Services communicate via:
1. REST APIs for synchronous requests
2. Message queues for asynchronous processing
3. gRPC for internal high-performance calls`},{id:"w3",title:"API Documentation",status:"draft",lastModified:"2024-03-12",content:`# API Documentation

## Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/login | User login |
| POST | /auth/register | New user registration |
| POST | /auth/refresh | Refresh access token |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | /users/me | Get current user profile |
| PUT | /users/me | Update current user |

> This documentation is still in draft. Please review before publishing.`},{id:"w4",title:"Contributing Guidelines",status:"published",lastModified:"2024-03-05",content:`# Contributing Guidelines

Thank you for your interest in contributing!

## Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write or update tests
5. Submit a pull request

## Code Style

- Use TypeScript for all new code
- Follow the existing naming conventions
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Review Process

All contributions require at least one review from a maintainer before merging.`},{id:"w5",title:"Deployment Guide",status:"draft",lastModified:"2024-03-11",content:`# Deployment Guide

## Prerequisites

- Docker and Docker Compose
- Kubernetes cluster (production)
- CI/CD pipeline access

## Development

\`\`\`
docker-compose up -d
\`\`\`

## Staging

Staging deployments are automatic on merge to the \`develop\` branch.

## Production

Production deployments require:
1. Approval from at least two team leads
2. All CI checks passing
3. Staging verification complete

> **Warning:** Always perform a database backup before production deployments.`}],E=typeof ProseMirror.Schema=="function"&&typeof ProseMirror.EditorState?.create=="function"&&typeof ProseMirror.EditorView=="function";function se(){let[P,C]=H("wikiActivePage","w1"),[p,f]=u.useState(ne),[M,b]=u.useState(!1),N=u.useRef(null),k=u.useRef(null),re=q(),T=B("publishPage"),g=P??"w1",i=p.find(e=>e.id===g)??p[0];u.useEffect(()=>{if(!E||!N.current)return;let e=new ProseMirror.Schema({nodes:{doc:{content:"block+"},paragraph:{group:"block",content:"inline*",toDOM:()=>["p",{class:"my-2 leading-relaxed"},0],parseDOM:[{tag:"p"}]},heading:{attrs:{level:{default:1}},content:"inline*",group:"block",defining:!0,toDOM:d=>{let s={1:"text-2xl font-bold mt-6 mb-3",2:"text-xl font-semibold mt-4 mb-2",3:"text-lg font-medium mt-3 mb-1"};return["h"+d.attrs.level,{class:s[d.attrs.level]||s[1]},0]},parseDOM:[{tag:"h1",attrs:{level:1}},{tag:"h2",attrs:{level:2}},{tag:"h3",attrs:{level:3}}]},callout:{content:"inline*",group:"block",toDOM:()=>["div",{class:"border-l-4 border-teal-400 bg-teal-50 dark:bg-teal-900/20 p-4 my-3 rounded-r"},0],parseDOM:[{tag:"div.callout"}]},text:{group:"inline"}},marks:{strong:{toDOM:()=>["strong",0],parseDOM:[{tag:"strong"}]},em:{toDOM:()=>["em",0],parseDOM:[{tag:"em"}]}}}),c=i.content.split(`
`),r=[];c.forEach(d=>{let s=d.trim();if(s)if(s.startsWith("### "))r.push(e.nodes.heading.create({level:3},[e.text(s.slice(4))]));else if(s.startsWith("## "))r.push(e.nodes.heading.create({level:2},[e.text(s.slice(3))]));else if(s.startsWith("# "))r.push(e.nodes.heading.create({level:1},[e.text(s.slice(2))]));else if(s.startsWith("> "))r.push(e.nodes.callout.create({},[e.text(s.slice(2))]));else{let w=[],G=/\*\*(.*?)\*\*/g,x=0,h;for(;(h=G.exec(s))!==null;)h.index>x&&w.push(e.text(s.slice(x,h.index))),w.push(e.text(h[1],[e.marks.strong.create()])),x=h.index+h[0].length;x<s.length&&w.push(e.text(s.slice(x))),w.length>0&&r.push(e.nodes.paragraph.create({},w))}});let m=e.nodes.doc.create({},r.length>0?r:[e.nodes.paragraph.create({},[e.text("Start writing...")])]),a=ProseMirror.EditorState.create({doc:m,plugins:[ProseMirror.history(),ProseMirror.keymap({"Mod-z":ProseMirror.undo,"Mod-y":ProseMirror.redo}),ProseMirror.keymap(ProseMirror.baseKeymap)]}),l=new ProseMirror.EditorView(N.current,{state:a,dispatchTransaction(d){let s=l.state.apply(d);l.updateState(s)}});return k.current=l,()=>{l.destroy(),k.current=null}},[g]);let R=u.useCallback(()=>{f(e=>e.map(c=>c.id===g?{...c,status:"published"}:c)),T({pageId:g}),I.success(`"${i.title}" published successfully!`),b(!1)},[g,i,T]),W=u.useCallback(()=>{I.success("Page saved!")},[]),v=u.useCallback(e=>{if(!k.current)return;let c=k.current,{state:r}=c,m=r.schema,a,l={};if(e==="heading-1"?(a=m.nodes.heading,l={level:1}):e==="heading-2"?(a=m.nodes.heading,l={level:2}):e==="heading-3"?(a=m.nodes.heading,l={level:3}):e==="callout"?a=m.nodes.callout:a=m.nodes.paragraph,a){let d=r.tr.setBlockType(r.selection.from,r.selection.to,a,l);c.dispatch(d)}},[]);return n("div",{className:"flex gap-0 min-h-[600px] border rounded-lg overflow-hidden",children:[n("div",{className:"w-72 border-r bg-muted/20 flex flex-col",children:[t("div",{className:"p-4 border-b",children:n("h3",{className:"font-semibold text-sm flex items-center gap-2",children:[t(o.BookOpen,{className:"h-4 w-4 text-teal-600"}),"Wiki Pages"]})}),t(F,{className:"flex-1",children:t("div",{className:"p-2 space-y-1",children:p.map(e=>n("button",{onClick:()=>C(e.id),className:A("w-full text-left rounded-lg p-3 transition-colors",g===e.id?"bg-teal-100 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800":"hover:bg-muted"),children:[t("div",{className:"flex items-center justify-between mb-1",children:t("span",{className:A("text-sm font-medium truncate",g===e.id&&"text-teal-700 dark:text-teal-300"),children:e.title})}),n("div",{className:"flex items-center gap-2",children:[t(O,{variant:e.status==="published"?"default":"secondary",className:A("text-xs",e.status==="published"?"bg-teal-600":"bg-yellow-100 text-yellow-800"),children:e.status}),t("span",{className:"text-xs text-muted-foreground",children:e.lastModified})]})]},e.id))})})]}),n("div",{className:"flex-1 flex flex-col",children:[n("div",{className:"border-b px-6 py-3 flex items-center justify-between bg-background",children:[n("div",{className:"flex items-center gap-3",children:[t("h2",{className:"text-lg font-semibold",children:i.title}),t(O,{variant:i.status==="published"?"default":"secondary",className:A(i.status==="published"?"bg-teal-600":"bg-yellow-100 text-yellow-800"),children:i.status})]}),n("div",{className:"flex items-center gap-2",children:[n($,{children:[t(X,{asChild:!0,children:n(S,{variant:"outline",size:"sm",children:[t(o.Type,{className:"mr-1 h-4 w-4"}),"Block Type",t(o.ChevronDown,{className:"ml-1 h-3 w-3"})]})}),n(Y,{children:[n(D,{onClick:()=>v("paragraph"),children:[t(o.AlignLeft,{className:"mr-2 h-4 w-4"}),"Paragraph"]}),n(D,{onClick:()=>v("heading-1"),children:[t(o.Heading1,{className:"mr-2 h-4 w-4"}),"Heading 1"]}),n(D,{onClick:()=>v("heading-2"),children:[t(o.Heading2,{className:"mr-2 h-4 w-4"}),"Heading 2"]}),n(D,{onClick:()=>v("heading-3"),children:[t(o.Heading3,{className:"mr-2 h-4 w-4"}),"Heading 3"]}),n(D,{onClick:()=>v("callout"),children:[t(o.Info,{className:"mr-2 h-4 w-4"}),"Callout"]})]})]}),n(S,{variant:"outline",size:"sm",onClick:W,children:[t(o.Save,{className:"mr-1 h-4 w-4"}),"Save"]}),n(j,{open:M,onOpenChange:b,children:[t(z,{asChild:!0,children:n(S,{size:"sm",className:"bg-teal-600 hover:bg-teal-700",disabled:i.status==="published",children:[t(o.Globe,{className:"mr-1 h-4 w-4"}),"Publish"]})}),n(U,{children:[n(L,{children:[t(K,{children:"Publish this page?"}),n(V,{children:['Publishing "',i.title,'" will make it visible to all wiki readers. This action can be undone by reverting to draft status.']})]}),n(_,{children:[t(Q,{children:"Cancel"}),t(J,{onClick:R,className:"bg-teal-600 hover:bg-teal-700",children:"Publish"})]})]})]})]})]}),t(te,{}),t("div",{className:"flex-1 overflow-auto",children:E?t("div",{ref:N,className:"min-h-[500px] px-8 py-6 prose prose-sm dark:prose-invert max-w-none [&_.ProseMirror]:outline-hidden [&_.ProseMirror]:min-h-[480px]"}):t("div",{className:"min-h-[500px] px-8 py-6 flex items-center justify-center",children:t(Z,{children:t(ee,{className:"py-12 text-center text-muted-foreground",children:"ProseMirror editor requires the full bundle (production mode). Only prosemirror-view is loaded; Schema, EditorState, and plugins require additional packages."})})})})]})]})}var le=se;export{le as default};

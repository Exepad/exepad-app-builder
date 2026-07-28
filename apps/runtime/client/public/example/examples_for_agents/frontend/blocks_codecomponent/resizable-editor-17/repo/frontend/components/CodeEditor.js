import{useAppState as u,ResizablePanelGroup as H,ResizablePanel as N,ResizableHandle as w,ScrollArea as v,ScrollBar as x,Tabs as F,TabsList as S,TabsTrigger as y,TabsContent as T,Button as C,Separator as j,Card as P,Icons as n,cn as M}from"@exepad/sdk";var g=window.React,e=(s,l,d)=>{let{children:i,...o}=l||{},c=d!==void 0?{...o,key:d}:o;return Array.isArray(i)?g.createElement.apply(g,[s,c].concat(i)):g.createElement(s,c,i)},a=e;var I=g.Fragment;var L=[{name:"src",type:"folder",children:[{name:"components",type:"folder",children:[{name:"Header.tsx",type:"file"},{name:"Footer.tsx",type:"file"}]},{name:"index.tsx",type:"file"},{name:"styles.css",type:"file"},{name:"utils.ts",type:"file"}]},{name:"package.json",type:"file"},{name:"tsconfig.json",type:"file"}],R={"index.tsx":`import React from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import "./styles.css";

export default function App() {
  return (
    <div className="app">
      <Header title="My App" />
      <main>
        <h1>Welcome</h1>
        <p>This is the main content area.</p>
      </main>
      <Footer />
    </div>
  );
}`,"styles.css":`.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: sans-serif;
}

main {
  flex: 1;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  font-size: 2rem;
  margin-bottom: 1rem;
  color: var(--foreground);
}`,"utils.ts":`export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function classNames(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}`,"Header.tsx":`import React from "react";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="header">
      <nav>
        <span className="logo">{title}</span>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
    </header>
  );
}`,"Footer.tsx":`import React from "react";

export function Footer() {
  return (
    <footer className="footer">
      <p>&copy; 2026 My App. All rights reserved.</p>
    </footer>
  );
}`,"package.json":`{
  "name": "my-app",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}`,"tsconfig.json":`{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "strict": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}`};function z({node:s,depth:l,selectedFile:d,onSelect:i,expandedFolders:o,onToggleFolder:c}){let m=s.type==="folder",p=o.includes(s.name),b=d===s.name;return a("div",{children:[a("button",{className:M("flex items-center gap-1.5 w-full text-left px-2 py-1 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors",b&&!m&&"bg-accent text-accent-foreground font-medium"),style:{paddingLeft:`${l*12+8}px`},onClick:()=>{m?c(s.name):i(s.name)},children:[m?p?e(n.ChevronDown,{className:"h-3.5 w-3.5 text-muted-foreground"}):e(n.ChevronRight,{className:"h-3.5 w-3.5 text-muted-foreground"}):e(n.File,{className:"h-3.5 w-3.5 text-muted-foreground"}),m?p?e(n.FolderOpen,{className:"h-3.5 w-3.5 text-yellow-500"}):e(n.Folder,{className:"h-3.5 w-3.5 text-yellow-500"}):null,e("span",{className:"truncate",children:s.name})]}),m&&p&&s.children&&e("div",{children:s.children.map(f=>e(z,{node:f,depth:l+1,selectedFile:d,onSelect:i,expandedFolders:o,onToggleFolder:c},f.name))})]})}function B(){let[s,l]=u("editorSelectedFile","index.tsx"),[d,i]=u("editorActiveTab","index.tsx"),[o,c]=u("editorOpenTabs",["index.tsx","styles.css","utils.ts"]),[m,p]=u("editorExpandedFolders",["src","components"]),[b,f]=u("editorRightTab","preview"),A=t=>{l(t),i(t),(o||[]).includes(t)||c([...o||[],t])},E=t=>{let r=(o||[]).filter(h=>h!==t);c(r),d===t&&(i(r.length>0?r[r.length-1]:""),l(r.length>0?r[r.length-1]:""))},k=t=>{let r=m||[];r.includes(t)?p(r.filter(h=>h!==t)):p([...r,t])},D=R[s||"index.tsx"]||"// No content available";return a(P,{className:"overflow-hidden border",children:[a("div",{className:"flex items-center gap-2 px-3 py-2 bg-muted/50",children:[e(n.Code,{className:"h-4 w-4 text-muted-foreground"}),e("span",{className:"text-sm font-medium",children:"Code Editor"}),e("div",{className:"flex-1"}),e(C,{variant:"ghost",size:"sm",className:"h-7 w-7 p-0",children:e(n.Settings,{className:"h-3.5 w-3.5"})}),e(C,{variant:"ghost",size:"sm",className:"h-7 w-7 p-0",children:e(n.Maximize2,{className:"h-3.5 w-3.5"})})]}),e(j,{}),e("div",{style:{height:"480px"},children:a(H,{direction:"horizontal",children:[e(N,{defaultSize:20,minSize:15,maxSize:35,children:a("div",{className:"h-full flex flex-col",children:[e("div",{className:"px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider",children:"Explorer"}),a(v,{className:"flex-1",children:[e("div",{className:"pb-4",children:L.map(t=>e(z,{node:t,depth:0,selectedFile:s||"",onSelect:A,expandedFolders:m||[],onToggleFolder:k},t.name))}),e(x,{orientation:"vertical"})]})]})}),e(w,{withHandle:!0}),e(N,{defaultSize:55,minSize:30,children:e("div",{className:"h-full flex flex-col",children:a(F,{value:d||"index.tsx",onValueChange:t=>{i(t),l(t)},children:[e("div",{className:"bg-muted/30",children:e(S,{className:"h-9 rounded-none bg-transparent p-0 border-b w-full justify-start",children:(o||[]).map(t=>a(y,{value:t,className:"relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs",children:[e(n.File,{className:"h-3 w-3 mr-1.5 text-muted-foreground"}),t,e("button",{className:"ml-2 hover:bg-accent rounded-sm p-0.5",onClick:r=>{r.stopPropagation(),E(t)},children:e(n.X,{className:"h-3 w-3"})})]},t))})}),(o||[]).map(t=>e(T,{value:t,className:"m-0 p-0",children:a(v,{className:"h-[440px]",children:[e("pre",{className:"p-4 text-xs font-mono leading-relaxed text-foreground",children:e("code",{children:R[t]||"// Empty file"})}),e(x,{orientation:"horizontal"}),e(x,{orientation:"vertical"})]})},t))]})})}),e(w,{withHandle:!0}),e(N,{defaultSize:25,minSize:15,maxSize:40,children:e("div",{className:"h-full flex flex-col",children:a(F,{value:b||"preview",onValueChange:t=>f(t),children:[e("div",{className:"bg-muted/30",children:a(S,{className:"h-9 rounded-none bg-transparent p-0 border-b w-full justify-start",children:[a(y,{value:"preview",className:"rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs",children:[e(n.Eye,{className:"h-3 w-3 mr-1.5"}),"Preview"]}),a(y,{value:"console",className:"rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background h-9 px-3 text-xs",children:[e(n.Terminal,{className:"h-3 w-3 mr-1.5"}),"Console"]})]})}),e(T,{value:"preview",className:"m-0 p-0",children:a(v,{className:"h-[440px]",children:[e("div",{className:"p-4 space-y-3",children:a("div",{className:"rounded-md border bg-background p-4",children:[e("div",{className:"border-b pb-2 mb-3",children:a("div",{className:"flex items-center gap-2 text-sm",children:[e("span",{className:"font-medium",children:"My App"}),e("span",{className:"text-muted-foreground",children:"|"}),e("span",{className:"text-xs text-muted-foreground",children:"Home"}),e("span",{className:"text-xs text-muted-foreground",children:"About"}),e("span",{className:"text-xs text-muted-foreground",children:"Contact"})]})}),e("h3",{className:"text-lg font-bold mb-1",children:"Welcome"}),e("p",{className:"text-sm text-muted-foreground",children:"This is the main content area."}),e("div",{className:"border-t mt-3 pt-2",children:e("p",{className:"text-xs text-muted-foreground",children:"\xA9 2026 My App. All rights reserved."})})]})}),e(x,{orientation:"vertical"})]})}),e(T,{value:"console",className:"m-0 p-0",children:a(v,{className:"h-[440px]",children:[a("div",{className:"p-4 font-mono text-xs space-y-1",children:[e("p",{className:"text-green-600",children:"[info] Server started on port 3000"}),e("p",{className:"text-muted-foreground",children:"[build] Compiled successfully in 243ms"}),e("p",{className:"text-muted-foreground",children:"[hmr] Connected to dev server"}),e("p",{className:"text-yellow-600",children:"[warn] React.StrictMode is enabled"}),e("p",{className:"text-muted-foreground",children:"[info] Watching for file changes..."})]}),e(x,{orientation:"vertical"})]})})]})})})]})})]})}var G=B;export{G as default};

import{React as g,useAppState as F,useTheme as P,toast as N,ResizablePanelGroup as E,ResizablePanel as w,ResizableHandle as L,Tabs as I,TabsList as D,TabsTrigger as j,TabsContent as M,Card as $,Button as y,Badge as S,ScrollArea as H,Icons as n,cn as O}from"@exepad/sdk";var p=window.React,t=(m,f,c)=>{let{children:o,...u}=f||{},r=c!==void 0?{...u,key:c}:u;return Array.isArray(o)?p.createElement.apply(p,[m,r].concat(o)):p.createElement(m,r,o)},a=t;var h=p.Fragment;var l=[{name:"App.tsx",language:"typescript",defaultContent:`import React, { useState } from "react";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, text: "Learn TypeScript", done: true },
    { id: 2, text: "Build a React app", done: false },
    { id: 3, text: "Deploy to production", done: false },
  ]);
  const [input, setInput] = useState("");

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos([...todos, { id: Date.now(), text: input, done: false }]);
    setInput("");
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Todo App</h1>
      <div className="flex gap-2 mb-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Add a todo..."
          className="flex-1 border rounded px-3 py-2"
        />
        <button onClick={addTodo} className="bg-blue-500 text-white px-4 py-2 rounded">
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {todos.map(todo => (
          <li
            key={todo.id}
            onClick={() => toggleTodo(todo.id)}
            className={\`p-3 border rounded cursor-pointer \${todo.done ? "line-through opacity-50" : ""}\`}
          >
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}`},{name:"styles.css",language:"css",defaultContent:`/* Base Styles */
:root {
  --primary: #2563eb;
  --primary-light: #60a5fa;
  --bg: #ffffff;
  --text: #1e293b;
  --border: #e2e8f0;
  --radius: 8px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Inter", -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.card {
  background: white;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: box-shadow 0.2s ease;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--primary);
  color: white;
  border: none;
}

.btn-primary:hover {
  background: var(--primary-light);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --text: #f8fafc;
    --border: #334155;
  }
}`},{name:"utils.ts",language:"typescript",defaultContent:`// Utility functions

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function classNames(
  ...classes: (string | boolean | undefined | null)[]
): string {
  return classes.filter(Boolean).join(" ");
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function groupBy<T>(
  arr: T[],
  key: keyof T
): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = String(item[key]);
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}`}];function W(){let m=P(),[f,c]=F("activeFile","App.tsx"),[o,u]=g.useState(()=>{let e={};return l.forEach(s=>{e[s.name]=s.defaultContent}),e}),[r,x]=g.useState([]),[v,T]=g.useState(!1),b=m.resolvedTheme==="dark",d=f??"App.tsx",R=l.find(e=>e.name===d)??l[0],C=g.useCallback(e=>{e!==void 0&&u(s=>({...s,[d]:e}))},[d]),i=()=>{let e=new Date;return`${e.getHours().toString().padStart(2,"0")}:${e.getMinutes().toString().padStart(2,"0")}:${e.getSeconds().toString().padStart(2,"0")}`},k=()=>{T(!0),x(e=>[...e,{type:"info",message:`[Build] Compiling ${Object.keys(o).length} files...`,timestamp:i()}]),setTimeout(()=>{x(e=>[...e,{type:"log",message:"[Build] TypeScript compilation successful.",timestamp:i()},{type:"log",message:"[Build] Bundle size: 14.2 KB (gzipped: 5.1 KB)",timestamp:i()},{type:"info",message:"[Runtime] Application started on port 3000",timestamp:i()},{type:"log",message:"[Runtime] Rendering App component...",timestamp:i()},{type:"log",message:"[Runtime] 3 todo items loaded from initial state",timestamp:i()}]),T(!1),N("Build completed successfully.")},1200)},z=()=>{N(`Saved ${d}`)},B=()=>{x([])},A={log:"text-foreground",error:"text-destructive",info:"text-blue-500",warn:"text-yellow-500"};return t("div",{className:"space-y-0",children:a($,{className:"overflow-hidden",children:[a("div",{className:"flex items-center justify-between border-b px-4 py-2 bg-muted/30",children:[a("div",{className:"flex items-center gap-2",children:[t(n.Code,{className:"h-4 w-4 text-primary"}),t("span",{className:"font-semibold text-sm",children:"Code Playground"})]}),a("div",{className:"flex items-center gap-2",children:[t(S,{variant:"outline",className:"text-xs",children:R.language}),a(y,{variant:"ghost",size:"sm",onClick:z,children:[t(n.Save,{className:"mr-1 h-3 w-3"}),"Save"]}),t(y,{size:"sm",onClick:k,disabled:v,children:v?a(h,{children:[t(n.Loader2,{className:"mr-1 h-3 w-3 animate-spin"}),"Running..."]}):a(h,{children:[t(n.Play,{className:"mr-1 h-3 w-3"}),"Run"]})})]})]}),a(E,{direction:"vertical",className:"min-h-[600px]",children:[t(w,{defaultSize:70,minSize:30,children:t("div",{className:"h-full flex flex-col",children:a(I,{value:d,onValueChange:e=>c(e),children:[t("div",{className:"border-b bg-muted/20 px-2",children:t(D,{className:"h-9 bg-transparent",children:l.map(e=>a(j,{value:e.name,className:"text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1",children:[e.name.endsWith(".tsx")||e.name.endsWith(".ts")?t(n.FileCode,{className:"h-3 w-3"}):t(n.FileText,{className:"h-3 w-3"}),e.name]},e.name))})}),l.map(e=>t(M,{value:e.name,className:"flex-1 m-0 p-0",children:typeof MonacoEditor=="function"?t(MonacoEditor,{height:"100%",language:e.language,theme:b?"vs-dark":"vs",value:o[e.name]??e.defaultContent,onChange:C,options:{minimap:{enabled:!1},fontSize:13,lineNumbers:"on",scrollBeyondLastLine:!1,wordWrap:"on",tabSize:2,automaticLayout:!0,padding:{top:8}}}):t("textarea",{style:{width:"100%",height:"400px",fontFamily:"monospace",fontSize:"13px",padding:"8px",border:"none",outline:"none",resize:"none",background:b?"#1e1e1e":"#ffffff",color:b?"#d4d4d4":"#1e1e1e"},value:o[e.name]??e.defaultContent,onChange:s=>C(s.target.value)})},e.name))]})})}),t(L,{withHandle:!0}),t(w,{defaultSize:30,minSize:15,children:a("div",{className:"h-full flex flex-col",children:[a("div",{className:"flex items-center justify-between border-b px-3 py-1.5 bg-muted/30",children:[a("div",{className:"flex items-center gap-2",children:[t(n.Terminal,{className:"h-3 w-3"}),t("span",{className:"text-xs font-medium",children:"Console"}),t(S,{variant:"secondary",className:"text-xs h-4 px-1",children:r.length})]}),a(y,{variant:"ghost",size:"sm",className:"h-6 text-xs",onClick:B,children:[t(n.Trash2,{className:"mr-1 h-3 w-3"}),"Clear"]})]}),t(H,{className:"flex-1 p-2",children:r.length===0?a("div",{className:"text-center py-8 text-muted-foreground",children:[t(n.Terminal,{className:"h-6 w-6 mx-auto mb-2 opacity-50"}),t("p",{className:"text-xs",children:"Console output will appear here. Click Run to execute."})]}):t("div",{className:"space-y-0.5 font-mono text-xs",children:r.map((e,s)=>a("div",{className:O("flex gap-2 px-1 py-0.5 rounded hover:bg-muted/50",A[e.type]),children:[t("span",{className:"text-muted-foreground shrink-0",children:e.timestamp}),t("span",{children:e.message})]},s))})})]})})]})]})})}var V=W;export{V as default};

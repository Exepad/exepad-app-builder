import{React as b,useModel as _,useNavigation as T,Button as h,Badge as L,Separator as w,ScrollArea as k,Icons as a,cn as g}from"@exepad/sdk";var p=window.React,e=(c,y,f)=>{let{children:s,...l}=y||{},m=f!==void 0?{...l,key:f}:l;return Array.isArray(s)?p.createElement.apply(p,[c,m].concat(s)):p.createElement(c,m,s)},o=e;var x=p.Fragment;var C=[{id:5,module_id:2,title:"Props, State & Lifecycle",content_type:"video",duration_min:35,sort_order:1,completed:!0},{id:6,module_id:2,title:"Custom Hooks Deep Dive",content_type:"video",duration_min:42,sort_order:2,completed:!1},{id:7,module_id:2,title:"Context API & useReducer",content_type:"video",duration_min:38,sort_order:3,completed:!1},{id:8,module_id:2,title:"State Management Exercise",content_type:"text",duration_min:20,sort_order:4,completed:!1}],n={id:6,module_id:2,title:"Custom Hooks Deep Dive",content_type:"video",duration_min:42,sort_order:2,description:"Learn how to extract reusable logic from your components into custom hooks. We'll cover the rules of hooks, common patterns like useLocalStorage, useFetch, and useDebounce, and how to properly type your custom hooks with TypeScript.",content:`## Custom Hooks Deep Dive

Custom hooks are one of the most powerful features in React. They let you extract component logic into reusable functions.

### Rules of Hooks
1. Only call hooks at the top level of your component or custom hook
2. Only call hooks from React functions (components or other hooks)
3. Custom hook names must start with "use"

### Building useLocalStorage

A common custom hook stores and retrieves values from localStorage:

\`\`\`typescript
function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    const valueToStore = value instanceof Function ? value(storedValue) : value;
    setStoredValue(valueToStore);
    window.localStorage.setItem(key, JSON.stringify(valueToStore));
  };

  return [storedValue, setValue] as const;
}
\`\`\`

### Building useFetch

A data fetching hook with loading and error states:

\`\`\`typescript
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
}
\`\`\`

### Key Takeaways
- Custom hooks promote code reuse and separation of concerns
- Always prefix with "use" to signal hook rules apply
- Return values that make sense for consumers (arrays for simple state, objects for complex)
- Test custom hooks independently using renderHook from Testing Library`};function E(){let{navigate:c}=T(),s=(_("lessons")?.data??C)||C,[l,m]=b.useState(!1),u=s.findIndex(t=>t.id===n.id),v=u>0?s[u-1]:null,N=u<s.length-1?s[u+1]:null,S={video:"Play",text:"FileText",quiz:"HelpCircle"};return o("div",{className:"flex h-[calc(100vh-4rem)]",children:[o("div",{className:"flex-1 flex flex-col overflow-hidden",children:[o("div",{className:"bg-gray-900 flex items-center justify-center relative",style:{minHeight:"360px"},children:[o("div",{className:"text-center",children:[e("div",{className:"w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4 hover:bg-white/20 cursor-pointer transition-colors",children:e(a.Play,{className:"w-10 h-10 text-white ml-1"})}),o("p",{className:"text-white/60 text-sm",children:[n.duration_min," min video"]})]}),e("div",{className:"absolute bottom-0 left-0 right-0 h-1 bg-white/10",children:e("div",{className:"h-full bg-primary w-[35%]"})})]}),e(k,{className:"flex-1",children:o("div",{className:"p-6 max-w-3xl mx-auto space-y-6",children:[o("div",{children:[o("div",{className:"flex items-center gap-2 mb-2",children:[e(L,{variant:"secondary",className:"capitalize",children:n.content_type}),o("span",{className:"text-xs text-muted-foreground flex items-center gap-1",children:[e(a.Clock,{className:"w-3 h-3"}),n.duration_min," min"]})]}),e("h1",{className:"text-2xl font-bold text-foreground",children:n.title}),e("p",{className:"text-muted-foreground mt-2",children:n.description})]}),e(w,{}),e("div",{className:"prose prose-sm max-w-none text-foreground",children:n.content.split(`

`).map((t,r)=>{if(t.startsWith("## "))return e("h2",{className:"text-xl font-bold mt-6 mb-3",children:t.replace("## ","")},r);if(t.startsWith("### "))return e("h3",{className:"text-lg font-semibold mt-5 mb-2",children:t.replace("### ","")},r);if(t.startsWith("```")){let d=t.split(`
`).slice(1,-1).join(`
`);return e("pre",{className:"bg-muted rounded-lg p-4 overflow-x-auto text-sm my-4",children:e("code",{className:"text-foreground",children:d})},r)}return t.match(/^\d\./)?e("ol",{className:"list-decimal list-inside space-y-1 my-2 text-muted-foreground",children:t.split(`
`).map((i,d)=>e("li",{children:i.replace(/^\d+\.\s*/,"")},d))},r):t.startsWith("- ")?e("ul",{className:"list-disc list-inside space-y-1 my-2 text-muted-foreground",children:t.split(`
`).map((i,d)=>e("li",{children:i.replace(/^-\s*/,"")},d))},r):e("p",{className:"text-muted-foreground leading-relaxed",children:t},r)})}),e(w,{}),o("div",{className:"flex items-center justify-between",children:[o("div",{className:"flex gap-2",children:[v&&o(h,{variant:"outline",onClick:()=>c(`/lesson/${v.id}`),children:[e(a.ArrowLeft,{className:"w-4 h-4 mr-2"}),"Previous"]}),N&&o(h,{onClick:()=>c(`/lesson/${N.id}`),children:["Next",e(a.ArrowRight,{className:"w-4 h-4 ml-2"})]})]}),e(h,{variant:l?"outline":"default",onClick:()=>m(!l),className:g(l&&"text-green-600 border-green-200"),children:l?o(x,{children:[e(a.CheckCircle,{className:"w-4 h-4 mr-2"}),"Completed"]}):o(x,{children:[e(a.Circle,{className:"w-4 h-4 mr-2"}),"Mark as Complete"]})})]})]})})]}),o("div",{className:"w-72 border-l border-border bg-background hidden lg:flex flex-col",children:[o("div",{className:"p-4 border-b border-border",children:[e("h3",{className:"font-semibold text-sm text-foreground",children:"Module: Component Patterns"}),o("p",{className:"text-xs text-muted-foreground mt-1",children:[s.filter(t=>t.completed).length,"/",s.length," completed"]})]}),e(k,{className:"flex-1",children:e("div",{className:"p-2 space-y-0.5",children:s.map(t=>{let r=t.id===n.id,i=a[S[t.content_type]];return o("button",{onClick:()=>c(`/lesson/${t.id}`),className:g("w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors text-sm",r?"lesson-active bg-accent border-l-primary":"hover:bg-muted"),children:[t.completed?e(a.CheckCircle,{className:"w-4 h-4 text-green-500 shrink-0"}):r?e(a.PlayCircle,{className:"w-4 h-4 text-primary shrink-0"}):i&&e(i,{className:"w-4 h-4 text-muted-foreground shrink-0"}),o("div",{className:"flex-1 min-w-0",children:[e("p",{className:g("truncate",r?"font-medium text-foreground":"text-muted-foreground"),children:t.title}),o("p",{className:"text-xs text-muted-foreground",children:[t.duration_min," min"]})]})]},t.id)})})})]})]})}export{E as default};

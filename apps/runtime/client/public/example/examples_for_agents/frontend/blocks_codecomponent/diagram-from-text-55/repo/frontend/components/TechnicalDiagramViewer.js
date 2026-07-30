import{React as v,useAppState as T,useTheme as U,toast as _,Card as E,CardHeader as y,CardTitle as D,CardContent as w,Button as q,Badge as S,Textarea as K,Input as V,Label as R,Select as X,SelectTrigger as j,SelectValue as G,SelectContent as z,SelectItem as J,Tabs as Q,TabsList as Y,TabsTrigger as I,Icons as o,cn as M}from"@exepad/sdk";import*as N from"@exepad/ext-mermaid";import*as L from"@exepad/ext-katex";var x=window.React,e=(d,b,n)=>{let{children:i,...l}=b||{},m=n!==void 0?{...l,key:n}:l;return Array.isArray(i)?x.createElement.apply(x,[d,m].concat(i)):x.createElement(d,m,i)},t=e;var W=x.Fragment;var c={flowchart:{label:"Flowchart",code:`flowchart TD
    A[Start] --> B{Is valid?}
    B -->|Yes| C[Process Data]
    B -->|No| D[Show Error]
    C --> E[Transform]
    E --> F[Save to DB]
    F --> G[Send Response]
    D --> H[Log Error]
    H --> I[Return 400]
    G --> J[End]
    I --> J`},sequence:{label:"Sequence Diagram",code:`sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API Gateway
    participant S as Service
    participant D as Database

    U->>F: Click Submit
    F->>A: POST /api/data
    A->>A: Validate Token
    A->>S: Forward Request
    S->>D: INSERT record
    D-->>S: OK
    S-->>A: 201 Created
    A-->>F: Response
    F-->>U: Show Success`},classDiagram:{label:"Class Diagram",code:`classDiagram
    class User {
        +String id
        +String name
        +String email
        +login()
        +logout()
    }
    class Order {
        +String id
        +Date createdAt
        +Float total
        +addItem()
        +removeItem()
        +checkout()
    }
    class Product {
        +String id
        +String name
        +Float price
        +Int stock
        +updateStock()
    }
    class OrderItem {
        +String id
        +Int quantity
        +Float subtotal
    }
    User "1" --> "*" Order : places
    Order "1" --> "*" OrderItem : contains
    OrderItem "*" --> "1" Product : references`},erDiagram:{label:"ER Diagram",code:`erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"
    CUSTOMER {
        string id PK
        string name
        string email
    }
    ORDER {
        string id PK
        date created_at
        string status
    }
    LINE_ITEM {
        string id PK
        int quantity
        float price
    }
    PRODUCT {
        string id PK
        string name
        float unit_price
    }`}},C=[{label:"Quadratic Formula",formula:"x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"},{label:"Euler's Identity",formula:"e^{i\\pi} + 1 = 0"},{label:"Bayes' Theorem",formula:"P(A|B) = \\frac{P(B|A) \\cdot P(A)}{P(B)}"},{label:"Taylor Series",formula:"f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n"},{label:"Fourier Transform",formula:"\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x) e^{-2\\pi i x \\xi} dx"}];function $(){let d=U(),[b,n]=T("diagramCode",c.flowchart.code),[i,l]=T("mathFormula",C[0].formula),[m,P]=T("activePreset","flowchart"),[F,A]=T("activeTab","diagram"),u=d.resolvedTheme==="dark",r=v.useRef(null),g=v.useRef(null),h=b??c.flowchart.code,f=i??C[0].formula,O=m??"flowchart",p=F??"diagram";v.useEffect(()=>{if(!r.current||p!=="diagram")return;(async()=>{try{N.default.initialize({startOnLoad:!1,theme:u?"dark":"default",securityLevel:"loose"}),r.current.innerHTML="";let{svg:s}=await N.default.render("mermaid-diagram-"+Date.now(),h);r.current&&(r.current.innerHTML=s)}catch(s){r.current&&(r.current.innerHTML=`<div class="text-destructive text-sm p-4">Diagram syntax error: ${s.message||"Invalid syntax"}</div>`)}})()},[h,u,p]),v.useEffect(()=>{if(g.current)try{g.current.innerHTML=L.renderToString(f,{displayMode:!0,throwOnError:!1,trust:!0})}catch{g.current.innerHTML='<span class="text-destructive text-sm">Invalid LaTeX formula</span>'}},[f]);let H=a=>{P(a),c[a]&&n(c[a].code)},B=()=>{if(!r.current)return;let a=r.current.querySelector("svg");if(a){let s=new XMLSerializer().serializeToString(a);navigator.clipboard.writeText(s).then(()=>{_("SVG copied to clipboard!")})}},k=a=>{l(a)};return t("div",{className:"grid grid-cols-1 lg:grid-cols-2 gap-4",children:[t(E,{children:[e(y,{className:"pb-3",children:t("div",{className:"flex items-center justify-between",children:[t(D,{className:"flex items-center gap-2 text-base",children:[e(o.Edit3,{className:"h-4 w-4"}),"Editor"]}),t(X,{value:O,onValueChange:H,children:[e(j,{className:"w-40 h-8",children:e(G,{placeholder:"Choose preset"})}),e(z,{children:Object.entries(c).map(([a,s])=>e(J,{value:a,children:s.label},a))})]})]})}),t(w,{className:"space-y-4",children:[t("div",{className:"space-y-2",children:[e(R,{className:"text-xs font-medium text-muted-foreground",children:"Mermaid Diagram Code"}),e(K,{value:h,onChange:a=>n(a.target.value),className:"min-h-[250px] font-mono text-sm resize-y",placeholder:"Enter Mermaid diagram code..."})]}),t("div",{className:"border-t pt-4 space-y-2",children:[e(R,{className:"text-xs font-medium text-muted-foreground",children:"LaTeX Formula"}),e(V,{value:f,onChange:a=>l(a.target.value),className:"font-mono text-sm",placeholder:"Enter LaTeX formula..."}),e("div",{className:"flex flex-wrap gap-1",children:C.map(a=>e(S,{variant:"outline",className:"text-xs cursor-pointer hover:bg-muted",onClick:()=>k(a.formula),children:a.label},a.label))})]})]})]}),t(E,{children:[e(y,{className:"pb-3",children:t("div",{className:"flex items-center justify-between",children:[t(D,{className:"flex items-center gap-2 text-base",children:[e(o.Eye,{className:"h-4 w-4"}),"Preview"]}),t("div",{className:"flex items-center gap-2",children:[e(Q,{value:p,onValueChange:a=>A(a),children:t(Y,{className:"h-8",children:[e(I,{value:"diagram",className:"text-xs px-3",children:"Diagram"}),e(I,{value:"math",className:"text-xs px-3",children:"Math"})]})}),t(q,{variant:"outline",size:"sm",onClick:B,className:"h-8",children:[e(o.Copy,{className:"mr-1 h-3 w-3"}),"Copy SVG"]})]})]})}),t(w,{children:[p==="diagram"?e("div",{ref:r,className:M("min-h-[300px] rounded-lg border p-4 overflow-auto flex items-center justify-center",u?"bg-slate-900/50":"bg-slate-50")}):t("div",{className:"space-y-4",children:[e("div",{ref:g,className:M("min-h-[120px] rounded-lg border p-6 overflow-auto flex items-center justify-center text-2xl",u?"bg-slate-900/50":"bg-slate-50")}),t("div",{className:"rounded-lg border p-3 bg-muted/30",children:[e("p",{className:"text-xs text-muted-foreground mb-1",children:"Raw LaTeX:"}),e("code",{className:"text-xs font-mono break-all",children:f})]})]}),t("div",{className:"flex items-center gap-3 mt-4 pt-3 border-t",children:[t(S,{variant:"secondary",className:"text-xs",children:[e(o.FileCode,{className:"mr-1 h-3 w-3"}),"Mermaid"]}),t(S,{variant:"secondary",className:"text-xs",children:[e(o.Sigma,{className:"mr-1 h-3 w-3"}),"KaTeX"]}),e("span",{className:"text-xs text-muted-foreground ml-auto",children:"Live preview updates as you type"})]})]})]})]})}var te=$;export{te as default};

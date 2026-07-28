import{React as g,useModel as E,useAppState as R,useTheme as I,Card as _,CardHeader as G,CardTitle as H,CardContent as B,Input as F,Badge as C,Button as j,DropdownMenu as O,DropdownMenuTrigger as U,DropdownMenuContent as z,DropdownMenuItem as N,Pagination as W,PaginationContent as q,PaginationItem as P,PaginationLink as J,PaginationPrevious as V,PaginationNext as $,Icons as i,cn as w}from"@exepad/sdk";import*as y from"@exepad/ext-prism";var v=window.React,t=(m,x,u)=>{let{children:l,...r}=x||{},s=u!==void 0?{...r,key:u}:r;return Array.isArray(l)?v.createElement.apply(v,[m,s].concat(l)):v.createElement(m,s,l)},n=t;var ne=v.Fragment;var X=y.oneDark||{},Z=y.oneLight||{},K=[{id:"s1",title:"Debounce Function",language:"javascript",code:`function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}`,tags:["utility","performance"]},{id:"s2",title:"Binary Search",language:"python",code:`def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`,tags:["algorithm","search"]},{id:"s3",title:"Generic Stack",language:"typescript",code:`class Stack<T> {
  private items: T[] = [];
  push(item: T): void { this.items.push(item); }
  pop(): T | undefined { return this.items.pop(); }
  peek(): T | undefined { return this.items[this.items.length - 1]; }
  get size(): number { return this.items.length; }
  isEmpty(): boolean { return this.items.length === 0; }
}`,tags:["data-structure","generics"]},{id:"s4",title:"HTTP Server",language:"go",code:`package main

import (
	"fmt"
	"net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])
}

func main() {
	http.HandleFunc("/", handler)
	http.ListenAndServe(":8080", nil)
}`,tags:["server","web"]},{id:"s5",title:"Fibonacci Iterator",language:"rust",code:`struct Fibonacci {
    a: u64,
    b: u64,
}

impl Iterator for Fibonacci {
    type Item = u64;
    fn next(&mut self) -> Option<u64> {
        let result = self.a;
        let next = self.a + self.b;
        self.a = self.b;
        self.b = next;
        Some(result)
    }
}`,tags:["iterator","math"]},{id:"s6",title:"Promise.all Polyfill",language:"javascript",code:`function promiseAll(promises) {
  return new Promise((resolve, reject) => {
    const results = [];
    let count = 0;
    promises.forEach((p, i) => {
      Promise.resolve(p).then(val => {
        results[i] = val;
        if (++count === promises.length) resolve(results);
      }).catch(reject);
    });
  });
}`,tags:["async","polyfill"]},{id:"s7",title:"Merge Sort",language:"python",code:`def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(l, r):
    result = []
    i = j = 0
    while i < len(l) and j < len(r):
        if l[i] <= r[j]:
            result.append(l[i]); i += 1
        else:
            result.append(r[j]); j += 1
    return result + l[i:] + r[j:]`,tags:["algorithm","sorting"]},{id:"s8",title:"Type Guard",language:"typescript",code:`interface Cat { meow(): void; whiskers: number; }
interface Dog { bark(): void; tail: boolean; }

function isCat(animal: Cat | Dog): animal is Cat {
  return 'meow' in animal;
}

function handleAnimal(animal: Cat | Dog) {
  if (isCat(animal)) {
    animal.meow();
  } else {
    animal.bark();
  }
}`,tags:["types","narrowing"]},{id:"s9",title:"Goroutine Worker Pool",language:"go",code:`func workerPool(jobs <-chan int, results chan<- int, n int) {
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				results <- job * 2
			}
		}()
	}
	wg.Wait()
	close(results)
}`,tags:["concurrency","goroutine"]},{id:"s10",title:"Smart Pointer",language:"rust",code:`use std::rc::Rc;
use std::cell::RefCell;

struct Node {
    value: i32,
    next: Option<Rc<RefCell<Node>>>,
}

fn main() {
    let a = Rc::new(RefCell::new(Node { value: 1, next: None }));
    let b = Rc::new(RefCell::new(Node { value: 2, next: Some(Rc::clone(&a)) }));
    println!("b -> a: {}", a.borrow().value);
}`,tags:["memory","ownership"]},{id:"s11",title:"Event Emitter",language:"javascript",code:`class EventEmitter {
  constructor() { this.events = {}; }
  on(event, fn) {
    (this.events[event] ||= []).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    this.events[event] = (this.events[event] || []).filter(f => f !== fn);
  }
  emit(event, ...args) {
    (this.events[event] || []).forEach(fn => fn(...args));
  }
}`,tags:["pattern","pubsub"]},{id:"s12",title:"Decorator Pattern",language:"python",code:`import functools
import time

def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper

@timer
def slow_function():
    time.sleep(1)
    return "done"`,tags:["decorator","timing"]}],Q=["All","JavaScript","Python","TypeScript","Go","Rust"],L={javascript:"JavaScript",python:"Python",typescript:"TypeScript",go:"Go",rust:"Rust"},Y={javascript:"bg-yellow-100 text-yellow-800",python:"bg-blue-100 text-blue-800",typescript:"bg-sky-100 text-sky-800",go:"bg-cyan-100 text-cyan-800",rust:"bg-orange-100 text-orange-800"},S=6;function ee(){let[m,x]=R("snippetSearch",""),[u,l]=R("snippetLang","All"),[r,s]=g.useState(1),te=E(),D=I(),c=m??"",o=u??"All",k=D?.resolvedTheme==="dark",p=g.useMemo(()=>{let e=K;if(o!=="All"&&(e=e.filter(a=>L[a.language]===o)),c){let a=c.toLowerCase();e=e.filter(d=>d.title.toLowerCase().includes(a)||d.language.toLowerCase().includes(a)||d.tags.some(h=>h.toLowerCase().includes(a)))}return e},[c,o]),f=Math.ceil(p.length/S),M=p.slice((r-1)*S,r*S);g.useEffect(()=>{s(1)},[c,o]);let T=g.useCallback(e=>{navigator.clipboard.writeText(e)},[]),A=g.useCallback(e=>{let a={javascript:"js",python:"py",typescript:"ts",go:"go",rust:"rs"},d=new Blob([e.code],{type:"text/plain"}),h=URL.createObjectURL(d),b=document.createElement("a");b.href=h,b.download=`${e.title.replace(/\s+/g,"_").toLowerCase()}.${a[e.language]||"txt"}`,b.click(),URL.revokeObjectURL(h)},[]);return n("div",{className:"space-y-6",children:[n("div",{className:"flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4",children:[n("div",{children:[n("h2",{className:"text-2xl font-bold flex items-center gap-2",children:[t(i.Code2,{className:"h-6 w-6 text-violet-600"}),"Snippet Gallery"]}),t("p",{className:"text-muted-foreground mt-1",children:"Browse and discover code snippets across languages"})]}),t("div",{className:"flex items-center gap-3 w-full sm:w-auto",children:n("div",{className:"relative flex-1 sm:flex-initial",children:[t(i.Search,{className:"absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"}),t(F,{placeholder:"Search snippets...",value:c,onChange:e=>x(e.target.value),className:"pl-9 w-full sm:w-[240px]"})]})})]}),n("div",{className:"flex flex-wrap gap-2",children:[Q.map(e=>t(j,{variant:o===e?"default":"outline",size:"sm",onClick:()=>l(e),className:w(o===e&&"bg-violet-600 hover:bg-violet-700"),children:e},e)),n(C,{variant:"secondary",className:"ml-auto",children:[p.length," snippets"]})]}),t("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",children:M.map(e=>n(_,{className:"overflow-hidden flex flex-col",children:[n(G,{className:"pb-2",children:[n("div",{className:"flex items-center justify-between",children:[t(H,{className:"text-sm font-semibold",children:e.title}),n(O,{children:[t(U,{asChild:!0,children:t(j,{variant:"ghost",size:"sm",className:"h-7 w-7 p-0",children:t(i.MoreVertical,{className:"h-4 w-4"})})}),n(z,{align:"end",children:[n(N,{onClick:()=>T(e.code),children:[t(i.Copy,{className:"mr-2 h-4 w-4"}),"Copy Code"]}),n(N,{children:[t(i.Share,{className:"mr-2 h-4 w-4"}),"Share"]}),n(N,{onClick:()=>A(e),children:[t(i.Download,{className:"mr-2 h-4 w-4"}),"Download"]})]})]})]}),n("div",{className:"flex items-center gap-2 mt-1",children:[t(C,{className:w("text-xs",Y[e.language]),children:L[e.language]}),e.tags.map(a=>t(C,{variant:"outline",className:"text-xs",children:a},a))]})]}),t(B,{className:"flex-1 pt-0",children:t("div",{className:"rounded-lg overflow-hidden text-sm",children:typeof PrismHighlighter=="function"?t(PrismHighlighter,{language:e.language,style:k?X:Z,customStyle:{margin:0,borderRadius:"0.5rem",fontSize:"0.75rem",maxHeight:"200px",overflow:"auto"},showLineNumbers:!0,children:e.code}):t("pre",{style:{margin:0,borderRadius:"0.5rem",fontSize:"0.75rem",maxHeight:"200px",overflow:"auto",padding:"1rem",background:k?"#1e1e1e":"#fafafa"},children:t("code",{children:e.code})})})})]},e.id))}),p.length===0&&n("div",{className:"text-center py-16 text-muted-foreground",children:[t(i.SearchX,{className:"h-12 w-12 mx-auto mb-3 opacity-50"}),t("p",{className:"text-lg",children:"No snippets found"}),t("p",{className:"text-sm",children:"Try adjusting your search or filter"})]}),f>1&&t(W,{children:n(q,{children:[t(P,{children:t(V,{onClick:()=>s(Math.max(1,r-1)),className:w(r===1&&"pointer-events-none opacity-50")})}),Array.from({length:f},(e,a)=>a+1).map(e=>t(P,{children:t(J,{onClick:()=>s(e),isActive:e===r,children:e})},e)),t(P,{children:t($,{onClick:()=>s(Math.min(f,r+1)),className:w(r===f&&"pointer-events-none opacity-50")})})]})})]})}var se=ee;export{se as default};

import {
  React,
  useFileUrl,
  useAppState,
  useTheme,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  ScrollArea,
  Input,
  Card,
  CardContent,
  Button,
  ButtonGroup,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as ReactPDFM from "@exepad/ext-pdf";
const ReactPDF: any = (ReactPDFM as any).default ? { ...ReactPDFM, ...(ReactPDFM as any).default } : ReactPDFM;

const TOTAL_PAGES = 12;

function PdfDocumentViewer() {
  const theme = useTheme();
  const isDark = theme.resolvedTheme === "dark";
  // In a real app: const pdfUrl = useFileUrl("document.pdf");
  const pdfUrl = "";
  const [currentPage, setCurrentPage] = useAppState<number>("currentPage", 1);
  const [zoomLevel, setZoomLevel] = useAppState<number>("zoomLevel", 1.0);
  const [searchQuery, setSearchQuery] = useAppState<string>("searchQuery", "");
  const [showThumbnails, setShowThumbnails] = useAppState<boolean>("showThumbnails", true);
  const [matchCount] = useAppState<number>("matchCount", 0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const thumbnailPages = React.useMemo(
    () => Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1),
    []
  );

  const handleZoomIn = () => setZoomLevel(Math.min(zoomLevel + 0.25, 3.0));
  const handleZoomOut = () => setZoomLevel(Math.max(zoomLevel - 0.25, 0.5));
  const handleFitWidth = () => setZoomLevel(1.0);
  const goToPage = (page: number) => {
    if (page >= 1 && page <= TOTAL_PAGES) setCurrentPage(page);
  };

  const visiblePageNumbers = React.useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(TOTAL_PAGES, currentPage + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Icons.FileText className="h-5 w-5 text-muted-foreground" />
              <span className="font-semibold text-sm">PDF Viewer</span>
              <Badge variant="secondary" className="text-xs">
                Page {currentPage} / {TOTAL_PAGES}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search in document..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearchQuery(e.target.value)
                  }
                  className="pl-8 h-8 w-48 text-sm"
                />
                {searchQuery && (
                  <Badge
                    variant="outline"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1"
                  >
                    {matchCount} matches
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ButtonGroup>
                <Button variant="outline" size="sm" onClick={handleZoomOut}>
                  <Icons.ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleFitWidth}>
                  <span className="text-xs px-1">{Math.round(zoomLevel * 100)}%</span>
                </Button>
                <Button variant="outline" size="sm" onClick={handleZoomIn}>
                  <Icons.ZoomIn className="h-4 w-4" />
                </Button>
              </ButtonGroup>
              <Button
                variant={showThumbnails ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowThumbnails(!showThumbnails)}
              >
                <Icons.PanelLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main content */}
      <div className="flex gap-4">
        {/* Thumbnail sidebar */}
        {showThumbnails && (
          <Card className="w-40 shrink-0">
            <CardContent className="p-2">
              <ScrollArea className="h-[600px]">
                <div className="flex flex-col gap-2 p-1">
                  {thumbnailPages.map((page) => (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={cn(
                        "relative rounded-md border-2 overflow-hidden transition-all cursor-pointer",
                        "hover:border-primary/50",
                        currentPage === page
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-border"
                      )}
                    >
                      <div
                        className={cn(
                          "w-full aspect-[3/4] flex items-center justify-center text-xs",
                          isDark ? "bg-zinc-800" : "bg-gray-100"
                        )}
                      >
                        <ReactPDF.Document file={pdfUrl || undefined} loading="">
                          <ReactPDF.Page
                            pageNumber={page}
                            width={120}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            loading={
                              <div className="flex items-center justify-center h-full text-muted-foreground">
                                <span className="text-[10px]">Page {page}</span>
                              </div>
                            }
                          />
                        </ReactPDF.Document>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-background/80 text-center py-0.5">
                        <span className="text-[10px] text-muted-foreground">{page}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* PDF Display */}
        <Card className="flex-1">
          <CardContent className="p-4">
            <div
              ref={containerRef}
              className={cn(
                "flex justify-center overflow-auto rounded-lg",
                isDark ? "bg-zinc-900" : "bg-gray-50"
              )}
              style={{ height: 600 }}
            >
              <div
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: "top center",
                  transition: "transform 0.2s ease",
                }}
              >
                <ReactPDF.Document
                  file={pdfUrl || undefined}
                  loading={
                    <div className="flex flex-col items-center justify-center h-96 text-muted-foreground gap-3">
                      <Icons.FileText className="h-16 w-16 opacity-30" />
                      <p className="text-sm">Loading PDF document...</p>
                      <p className="text-xs opacity-50">
                        Connect a file source with useFileUrl to display a real PDF
                      </p>
                    </div>
                  }
                  error={
                    <div className="flex flex-col items-center justify-center h-96 text-muted-foreground gap-3">
                      <Icons.FileText className="h-16 w-16 opacity-30" />
                      <p className="text-sm font-medium">PDF Document Viewer</p>
                      <p className="text-xs opacity-50">
                        No PDF loaded. Use useFileUrl to connect a document.
                      </p>
                      <div
                        className={cn(
                          "mt-4 w-[500px] aspect-[3/4] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2",
                          isDark ? "border-zinc-700" : "border-gray-300"
                        )}
                      >
                        <Icons.Upload className="h-8 w-8 opacity-20" />
                        <span className="text-xs opacity-40">
                          Page {currentPage} of {TOTAL_PAGES}
                        </span>
                      </div>
                    </div>
                  }
                >
                  <ReactPDF.Page
                    pageNumber={currentPage}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={
                      <div className="flex items-center justify-center h-96">
                        <Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  />
                </ReactPDF.Document>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pagination */}
      <div className="flex justify-center">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => goToPage(currentPage - 1)}
                className={cn(currentPage <= 1 && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            {visiblePageNumbers.map((page) => (
              <PaginationItem key={page}>
                <PaginationLink
                  isActive={page === currentPage}
                  onClick={() => goToPage(page)}
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => goToPage(currentPage + 1)}
                className={cn(currentPage >= TOTAL_PAGES && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

export default PdfDocumentViewer;

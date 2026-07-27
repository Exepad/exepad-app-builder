import {
  React,
  useAppState,
  useTheme,
  toast,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
  Icons,
  cn,
} from "@exepad/sdk";
import * as QRCodeM from "@exepad/ext-qrcode";
const QRCode: React.ComponentType<any> = typeof _qr === 'function' ? _qr : _qr?.QRCodeCanvas || _qr?.default || _qr;

interface QrState {
  content: string;
  size: string;
  errorLevel: string;
  fgColor: string;
  bgColor: string;
  activeTab: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiEncryption: string;
  vcardName: string;
  vcardPhone: string;
  vcardEmail: string;
}

const DEFAULT_STATE: QrState = {
  content: "https://exepad.com",
  size: "256",
  errorLevel: "M",
  fgColor: "#000000",
  bgColor: "#ffffff",
  activeTab: "url",
  wifiSsid: "MyNetwork",
  wifiPassword: "password123",
  wifiEncryption: "WPA",
  vcardName: "Jane Doe",
  vcardPhone: "+1234567890",
  vcardEmail: "jane@example.com",
};

function QrCodeGenerator() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [state, setState] = useAppState<QrState>("qrState", DEFAULT_STATE);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const s = state ?? DEFAULT_STATE;

  const getQrContent = React.useCallback(() => {
    switch (s.activeTab) {
      case "wifi":
        return `WIFI:T:${s.wifiEncryption};S:${s.wifiSsid};P:${s.wifiPassword};;`;
      case "vcard":
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${s.vcardName}\nTEL:${s.vcardPhone}\nEMAIL:${s.vcardEmail}\nEND:VCARD`;
      default:
        return s.content;
    }
  }, [s]);

  const handleDownload = () => {
    try {
      const canvas = wrapperRef.current?.querySelector("canvas");
      if (!canvas) {
        toast.error("QR code canvas not found");
        return;
      }
      const link = document.createElement("a");
      link.download = "qrcode.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("QR code downloaded as PNG");
    } catch {
      toast.error("Failed to download QR code");
    }
  };

  const update = (patch: Partial<QrState>) => {
    setState({ ...s, ...patch });
  };

  const qrContent = getQrContent() || " ";
  const qrSize = parseInt(s.size, 10);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icons.QrCode className="h-5 w-5 text-primary" />
              <CardTitle>QR Code Generator</CardTitle>
            </div>
            <Badge variant="secondary">{s.size}px</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Content Tabs */}
          <Tabs value={s.activeTab} onValueChange={(v: string) => update({ activeTab: v })}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="url">URL / Text</TabsTrigger>
              <TabsTrigger value="vcard">vCard</TabsTrigger>
              <TabsTrigger value="wifi">WiFi</TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-3 mt-4">
              <div>
                <Label>URL or Text</Label>
                <Input
                  value={s.content}
                  onChange={(e) => update({ content: e.target.value })}
                  placeholder="Enter URL or text..."
                />
              </div>
            </TabsContent>

            <TabsContent value="vcard" className="space-y-3 mt-4">
              <div>
                <Label>Full Name</Label>
                <Input
                  value={s.vcardName}
                  onChange={(e) => update({ vcardName: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={s.vcardPhone}
                  onChange={(e) => update({ vcardPhone: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={s.vcardEmail}
                  onChange={(e) => update({ vcardEmail: e.target.value })}
                />
              </div>
            </TabsContent>

            <TabsContent value="wifi" className="space-y-3 mt-4">
              <div>
                <Label>SSID</Label>
                <Input
                  value={s.wifiSsid}
                  onChange={(e) => update({ wifiSsid: e.target.value })}
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  value={s.wifiPassword}
                  onChange={(e) => update({ wifiPassword: e.target.value })}
                />
              </div>
              <div>
                <Label>Encryption</Label>
                <Select value={s.wifiEncryption} onValueChange={(v: string) => update({ wifiEncryption: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WPA">WPA/WPA2</SelectItem>
                    <SelectItem value="WEP">WEP</SelectItem>
                    <SelectItem value="nopass">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
          </Tabs>

          {/* Options */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Size</Label>
              <Select value={s.size} onValueChange={(v: string) => update({ size: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="128">128px</SelectItem>
                  <SelectItem value="256">256px</SelectItem>
                  <SelectItem value="512">512px</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Error Correction</Label>
              <Select value={s.errorLevel} onValueChange={(v: string) => update({ errorLevel: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="L">Low (7%)</SelectItem>
                  <SelectItem value="M">Medium (15%)</SelectItem>
                  <SelectItem value="Q">Quartile (25%)</SelectItem>
                  <SelectItem value="H">High (30%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Foreground</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={s.fgColor}
                  onChange={(e) => update({ fgColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border"
                />
                <span className="text-sm text-muted-foreground">{s.fgColor}</span>
              </div>
            </div>
            <div>
              <Label>Background</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={s.bgColor}
                  onChange={(e) => update({ bgColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border"
                />
                <span className="text-sm text-muted-foreground">{s.bgColor}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 space-y-4">
          <div
            ref={wrapperRef}
            className={cn(
              "rounded-lg p-4 border",
              isDark ? "bg-zinc-900 border-zinc-700" : "bg-white border-zinc-200"
            )}
          >
            <QRCode
              value={qrContent}
              size={qrSize}
              fgColor={s.fgColor}
              bgColor={s.bgColor}
              level={s.errorLevel}
            />
          </div>
          <Button onClick={handleDownload}>
            <Icons.Download className="h-4 w-4 mr-2" />
            Download PNG
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default QrCodeGenerator;

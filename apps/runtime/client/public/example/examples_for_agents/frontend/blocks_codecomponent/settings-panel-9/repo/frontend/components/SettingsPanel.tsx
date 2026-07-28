import {
  React,
  useAppState,
  toast,
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
  FieldLegend,
  Switch,
  Slider,
  Kbd,
  KbdGroup,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  RadioGroup,
  RadioGroupItem,
  Label,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

function SettingsPanel() {
  const [displayName, setDisplayName] = useAppState<string>(
    "displayName",
    "Jane Doe"
  );
  const [bio, setBio] = useAppState<string>(
    "bio",
    "Full-stack developer who loves building great user experiences."
  );
  const [emailNotifs, setEmailNotifs] = useAppState<boolean>(
    "emailNotifs",
    true
  );
  const [pushNotifs, setPushNotifs] = useAppState<boolean>(
    "pushNotifs",
    false
  );
  const [smsNotifs, setSmsNotifs] = useAppState<boolean>("smsNotifs", false);
  const [fontSize, setFontSize] = useAppState<number[]>("fontSize", [16]);
  const [layout, setLayout] = useAppState<string>("layout", "comfortable");
  const [language, setLanguage] = useAppState<string>("language", "en");

  const handleSave = () => {
    toast("Settings saved successfully!");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.Settings className="h-5 w-5" />
            Settings
          </CardTitle>
          <CardDescription>
            Manage your account preferences and application settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultValue={["profile", "notifications"]}>
            <AccordionItem value="profile">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Icons.User className="h-4 w-4" />
                  Profile
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="space-y-4 pt-2">
                  <Field>
                    <FieldLabel>Display Name</FieldLabel>
                    <FieldDescription>
                      This is the name shown on your public profile.
                    </FieldDescription>
                    <Input
                      value={displayName ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setDisplayName(e.target.value)
                      }
                      placeholder="Your display name"
                    />
                  </Field>
                  <FieldSeparator />
                  <Field>
                    <FieldLabel>Bio</FieldLabel>
                    <FieldDescription>
                      A short description about yourself (max 160 characters).
                    </FieldDescription>
                    <Textarea
                      value={bio ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setBio(e.target.value)
                      }
                      placeholder="Tell us about yourself..."
                      className="resize-none"
                      rows={3}
                      maxLength={160}
                    />
                  </Field>
                  <FieldSeparator />
                  <Field>
                    <FieldLabel>Language</FieldLabel>
                    <FieldDescription>
                      Select your preferred application language.
                    </FieldDescription>
                    <Select
                      value={language ?? "en"}
                      onValueChange={(val: string) => setLanguage(val)}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                        <SelectItem value="de">German</SelectItem>
                        <SelectItem value="ja">Japanese</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="notifications">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Icons.Bell className="h-4 w-4" />
                  Notifications
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <FieldSet className="pt-2">
                  <FieldLegend>Notification Channels</FieldLegend>
                  <FieldGroup className="space-y-4">
                    <Field>
                      <FieldContent className="flex items-center justify-between">
                        <div>
                          <FieldTitle>Email Notifications</FieldTitle>
                          <FieldDescription>
                            Receive updates and alerts via email.
                          </FieldDescription>
                        </div>
                        <Switch
                          checked={emailNotifs ?? true}
                          onCheckedChange={setEmailNotifs}
                        />
                      </FieldContent>
                    </Field>
                    <FieldSeparator />
                    <Field>
                      <FieldContent className="flex items-center justify-between">
                        <div>
                          <FieldTitle>Push Notifications</FieldTitle>
                          <FieldDescription>
                            Get real-time push notifications in your browser.
                          </FieldDescription>
                        </div>
                        <Switch
                          checked={pushNotifs ?? false}
                          onCheckedChange={setPushNotifs}
                        />
                      </FieldContent>
                    </Field>
                    <FieldSeparator />
                    <Field>
                      <FieldContent className="flex items-center justify-between">
                        <div>
                          <FieldTitle>SMS Notifications</FieldTitle>
                          <FieldDescription>
                            Receive important alerts via text message.
                          </FieldDescription>
                        </div>
                        <Switch
                          checked={smsNotifs ?? false}
                          onCheckedChange={setSmsNotifs}
                        />
                      </FieldContent>
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="display">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Icons.Monitor className="h-4 w-4" />
                  Display
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="space-y-6 pt-2">
                  <Field>
                    <FieldLabel>
                      Font Size: {(fontSize ?? [16])[0]}px
                    </FieldLabel>
                    <FieldDescription>
                      Adjust the base font size for the application (12-24px).
                    </FieldDescription>
                    <Slider
                      value={fontSize ?? [16]}
                      onValueChange={(val: number[]) => setFontSize(val)}
                      min={12}
                      max={24}
                      step={1}
                      className="mt-2"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>12px</span>
                      <span>18px</span>
                      <span>24px</span>
                    </div>
                  </Field>
                  <FieldSeparator />
                  <Field>
                    <FieldLabel>Layout Density</FieldLabel>
                    <FieldDescription>
                      Choose how compact the interface should be.
                    </FieldDescription>
                    <RadioGroup
                      value={layout ?? "comfortable"}
                      onValueChange={(val: string) => setLayout(val)}
                      className="space-y-2 mt-2"
                    >
                      {[
                        {
                          value: "compact",
                          label: "Compact",
                          desc: "Smaller spacing, more content visible",
                        },
                        {
                          value: "comfortable",
                          label: "Comfortable",
                          desc: "Balanced spacing for everyday use",
                        },
                        {
                          value: "spacious",
                          label: "Spacious",
                          desc: "Extra breathing room between elements",
                        },
                      ].map((opt) => (
                        <div key={opt.value} className="flex items-center gap-3">
                          <RadioGroupItem
                            value={opt.value}
                            id={`layout-${opt.value}`}
                          />
                          <Label
                            htmlFor={`layout-${opt.value}`}
                            className="flex flex-col cursor-pointer"
                          >
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {opt.desc}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </Field>
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="shortcuts">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Icons.Keyboard className="h-4 w-4" />
                  Keyboard Shortcuts
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="space-y-3 pt-2">
                  {[
                    { action: "Save settings", keys: ["Ctrl", "S"] },
                    { action: "Search", keys: ["Ctrl", "K"] },
                    { action: "Toggle sidebar", keys: ["Ctrl", "B"] },
                    { action: "Open command palette", keys: ["Ctrl", "Shift", "P"] },
                    { action: "Navigate back", keys: ["Alt", "Left"] },
                    { action: "Toggle dark mode", keys: ["Ctrl", "Shift", "D"] },
                  ].map((shortcut) => (
                    <Field key={shortcut.action}>
                      <FieldContent className="flex items-center justify-between py-1">
                        <span className="text-sm">{shortcut.action}</span>
                        <KbdGroup>
                          {shortcut.keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      </FieldContent>
                    </Field>
                  ))}
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Icons.Save className="mr-2 h-4 w-4" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}

export default SettingsPanel;

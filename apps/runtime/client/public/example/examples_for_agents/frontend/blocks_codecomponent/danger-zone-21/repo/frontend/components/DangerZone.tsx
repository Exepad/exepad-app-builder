import {
  React,
  useHandler,
  toast,
  useAppState,
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  Alert,
  AlertTitle,
  AlertDescription,
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

function DangerZone() {
  const [resetOpen, setResetOpen] = useAppState<boolean>("resetOpen", false);
  const [exportOpen, setExportOpen] = useAppState<boolean>("exportOpen", false);
  const [deleteStep, setDeleteStep] = useAppState<number>("deleteStep", 0);
  const [deleteOpen, setDeleteOpen] = useAppState<boolean>("deleteOpen", false);
  const [deleteConfirmText, setDeleteConfirmText] = useAppState<string>(
    "deleteConfirmText",
    ""
  );
  const [isResetting, setIsResetting] = useAppState<boolean>("isResetting", false);
  const [isExporting, setIsExporting] = useAppState<boolean>("isExporting", false);
  const [isDeleting, setIsDeleting] = useAppState<boolean>("isDeleting", false);

  const handleReset = useHandler("reset_settings");
  const handleExport = useHandler("export_data");
  const handleDelete = useHandler("delete_account");

  const onResetConfirm = () => {
    setIsResetting(true);
    setTimeout(() => {
      handleReset({});
      setIsResetting(false);
      setResetOpen(false);
      toast("Settings have been reset to defaults.");
    }, 1200);
  };

  const onExportConfirm = () => {
    setIsExporting(true);
    setTimeout(() => {
      handleExport({});
      setIsExporting(false);
      setExportOpen(false);
      setDeleteStep(1);
      toast("Data exported successfully. Confirm deletion below.");
    }, 1500);
  };

  const onDeleteAfterExport = () => {
    setIsDeleting(true);
    setTimeout(() => {
      handleDelete({});
      setIsDeleting(false);
      setDeleteStep(0);
      toast("All data has been permanently deleted.");
    }, 2000);
  };

  const onDeleteAccountConfirm = () => {
    if ((deleteConfirmText ?? "") !== "DELETE") return;
    setIsDeleting(true);
    setTimeout(() => {
      handleDelete({ type: "account" });
      setIsDeleting(false);
      setDeleteOpen(false);
      setDeleteConfirmText("");
      toast("Your account has been scheduled for deletion.");
    }, 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Icons.AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions that affect your account and data. Please proceed
            with caution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Section 1: Reset Settings */}
          <div className="space-y-3">
            <Alert>
              <Icons.AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Resetting will revert all preferences and configurations to their
                factory defaults. Your data will not be affected.
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Reset Settings</h3>
                <p className="text-xs text-muted-foreground">
                  Restore all settings to default values
                </p>
              </div>
              <AlertDialog
                open={resetOpen ?? false}
                onOpenChange={setResetOpen}
              >
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <Icons.RotateCcw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will revert all your preferences, notification
                      settings, display options, and keyboard shortcuts to their
                      default values. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onResetConfirm}
                      disabled={isResetting ?? false}
                    >
                      {isResetting ? (
                        <>
                          <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        "Yes, reset everything"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <Separator />

          {/* Section 2: Export & Delete Data (multi-step) */}
          <div className="space-y-3">
            <Alert variant="default">
              <Icons.Info className="h-4 w-4" />
              <AlertTitle>Export & Delete</AlertTitle>
              <AlertDescription>
                First export a copy of your data, then confirm permanent deletion.
                This is a two-step process to protect against accidental data loss.
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Export & Delete Data</h3>
                <p className="text-xs text-muted-foreground">
                  Download your data then permanently remove it
                </p>
              </div>

              {(deleteStep ?? 0) === 0 ? (
                <AlertDialog
                  open={exportOpen ?? false}
                  onOpenChange={setExportOpen}
                >
                  <AlertDialogTrigger asChild>
                    <Button>
                      <Icons.Download className="mr-2 h-4 w-4" />
                      Export & Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Step 1: Export your data
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        We will generate a downloadable archive containing all your
                        projects, files, and settings. After export completes, you
                        will be asked to confirm permanent deletion.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onExportConfirm}
                        disabled={isExporting ?? false}
                      >
                        {isExporting ? (
                          <>
                            <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Icons.Download className="mr-2 h-4 w-4" />
                            Start Export
                          </>
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Icons.Trash className="mr-2 h-4 w-4" />
                      Confirm Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Step 2: Confirm permanent deletion
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Your data has been exported. Proceeding will permanently
                        delete all projects, files, and associated resources from
                        our servers. This cannot be reversed.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setDeleteStep(0)}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={onDeleteAfterExport}
                        disabled={isDeleting ?? false}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isDeleting ? (
                          <>
                            <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Icons.Trash className="mr-2 h-4 w-4" />
                            Delete Everything
                          </>
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          <Separator />

          {/* Section 3: Delete Account */}
          <div className="space-y-3">
            <Alert variant="destructive">
              <Icons.ShieldAlert className="h-4 w-4" />
              <AlertTitle>Permanent Account Deletion</AlertTitle>
              <AlertDescription>
                Deleting your account is permanent and irreversible. All data,
                projects, subscriptions, and associated resources will be
                immediately destroyed. You will not be able to recover anything.
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-destructive">
                  Delete Account
                </h3>
                <p className="text-xs text-muted-foreground">
                  Permanently remove your account and all data
                </p>
              </div>
              <AlertDialog
                open={deleteOpen ?? false}
                onOpenChange={(open: boolean) => {
                  setDeleteOpen(open);
                  if (!open) setDeleteConfirmText("");
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Icons.UserX className="mr-2 h-4 w-4" />
                    Delete Account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive">
                      Delete your account?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete your account and all associated
                      data. This action is irreversible. To confirm, please type{" "}
                      <span className="font-mono font-bold text-foreground">
                        DELETE
                      </span>{" "}
                      below.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="py-4">
                    <Input
                      placeholder='Type "DELETE" to confirm'
                      value={deleteConfirmText ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setDeleteConfirmText(e.target.value)
                      }
                      className={cn(
                        "font-mono",
                        (deleteConfirmText ?? "") === "DELETE"
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      )}
                    />
                    {(deleteConfirmText ?? "").length > 0 &&
                      (deleteConfirmText ?? "") !== "DELETE" && (
                        <p className="text-xs text-destructive mt-1">
                          Please type DELETE exactly (case-sensitive)
                        </p>
                      )}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onDeleteAccountConfirm}
                      disabled={
                        (deleteConfirmText ?? "") !== "DELETE" ||
                        (isDeleting ?? false)
                      }
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? (
                        <>
                          <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Deleting account...
                        </>
                      ) : (
                        <>
                          <Icons.Trash className="mr-2 h-4 w-4" />
                          Permanently Delete Account
                        </>
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DangerZone;

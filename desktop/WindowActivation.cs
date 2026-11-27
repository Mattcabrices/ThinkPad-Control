namespace ThinkPad.Desktop;

// A second launch can signal before WinForms creates its HWND. Keep that
// request until the UI can accept it, and coalesce repeated launch signals.
internal sealed class WindowActivation(Func<Action, bool> tryPost, Action show)
{
    private readonly object gate = new();
    private bool pending, queued, stopped;

    public void Request()
    {
        lock (gate)
        {
            if (stopped) return;
            pending = true;
            Schedule();
        }
    }

    public void HandleReady()
    {
        lock (gate) Schedule();
    }

    private void Schedule()
    {
        if (stopped || !pending || queued) return;
        queued = true;
        if (!tryPost(Drain)) queued = false;
    }

    private void Drain()
    {
        lock (gate)
        {
            queued = false;
            if (stopped || !pending) return;
            pending = false;
            show();
        }
    }

    public void Stop()
    {
        lock (gate) { stopped = true; pending = false; }
    }
}

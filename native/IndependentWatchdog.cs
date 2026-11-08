// Keep the primary fan's lease check independent of slow sensor/provider work.
internal static class IndependentWatchdog
{
    public static void Tick(object sensorGate,Action primaryFan,Action sensorControls)
    {
        primaryFan();
        if(!Monitor.TryEnter(sensorGate))return;
        try{sensorControls();}finally{Monitor.Exit(sensorGate);}
    }
}

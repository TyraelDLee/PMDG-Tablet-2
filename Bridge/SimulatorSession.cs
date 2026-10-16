// Pure session policy: a manually started bridge may wait indefinitely for MSFS.
// Once any startup mode sees MSFS, shutdown follows confirmed process disappearance.
internal sealed class SimulatorSession(bool autoStarted) {
    bool seen;
    TimeSpan? absentSince;
    public bool ShouldStop(TimeSpan elapsed, bool? running) {
        if (running is null) { absentSince=null; return false; }
        if (running.Value) { seen=true; absentSince=null; return false; }
        if (!seen) return autoStarted && elapsed>=TimeSpan.FromMinutes(15);
        absentSince ??= elapsed;
        return elapsed-absentSince.Value>=TimeSpan.FromSeconds(6);
    }
}

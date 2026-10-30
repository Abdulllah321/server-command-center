import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Plus, Trash2, Copy, Save } from 'lucide-react';
import { toast } from 'sonner';
import { showIpcError } from '@/lib/error-handler';
import { 
  type RebuildProfile, 
  type RebuildStep,
  listProfiles, 
  createProfile, 
  updateProfile, 
  deleteProfile 
} from '@/lib/tauri-client';

export const RebuildProfileManager = () => {
  const [profiles, setProfiles] = useState<RebuildProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Editor state
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<RebuildStep[]>([]);
  const [isBuiltin, setIsBuiltin] = useState(false);
  const [isEditingNew, setIsEditingNew] = useState(false);
  
  const loadProfiles = async () => {
    try {
      const data = await listProfiles();
      setProfiles(data);
      if (!selectedId && data.length > 0) {
        selectProfile(data[0].id, data);
      } else if (selectedId) {
        // Refresh selected
        selectProfile(selectedId, data);
      }
    } catch (err: any) {
      showIpcError(err, { action: 'Load Profiles' });
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const selectProfile = (id: string, list: RebuildProfile[] = profiles) => {
    const prof = list.find(p => p.id === id);
    if (prof) {
      setSelectedId(id);
      setName(prof.name);
      setSteps(prof.steps);
      setIsBuiltin(prof.is_builtin);
      setIsEditingNew(false);
    }
  };

  const handleNewProfile = () => {
    setSelectedId(null);
    setName('New Profile');
    setSteps([]);
    setIsBuiltin(false);
    setIsEditingNew(true);
  };
  
  const handleDuplicate = () => {
    setSelectedId(null);
    setName(`${name} (Copy)`);
    setIsBuiltin(false);
    setIsEditingNew(true);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;
    
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = newSteps[index];
    newSteps[index] = newSteps[targetIndex];
    newSteps[targetIndex] = temp;
    setSteps(newSteps);
  };

  const updateStep = (index: number, field: keyof RebuildStep, value: any) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const addStep = () => {
    setSteps([...steps, { label: 'New Step', command: '', continue_on_error: false }]);
  };

  const handleSave = async () => {
    try {
      if (isEditingNew) {
        const newProf = await createProfile({ name, steps });
        setSelectedId(newProf.id);
        setIsEditingNew(false);
      } else if (selectedId) {
        await updateProfile(selectedId, { name, steps });
      }
      await loadProfiles();
      toast.success('Profile saved successfully');
    } catch (err: any) {
      showIpcError(err, { action: 'Save Profile' });
    }
  };

  const handleDelete = async () => {
    if (!selectedId || isBuiltin) return;
    if (confirm("Are you sure you want to delete this custom profile?")) {
      try {
        await deleteProfile(selectedId);
        setSelectedId(null);
        await loadProfiles();
        toast.success('Profile deleted successfully');
      } catch (err) {
        showIpcError(err, { action: 'Delete Profile' });
      }
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-[800px]">
      {/* Sidebar */}
      <Card className="col-span-4 h-full flex flex-col">
        <CardHeader>
          <CardTitle>Rebuild Profiles</CardTitle>
          <CardDescription>Manage deployment pipelines</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-0">
          <div className="px-4 space-y-2">
            <Button variant="outline" className="w-full justify-start" onClick={handleNewProfile}>
              <Plus className="mr-2 h-4 w-4" /> New Custom Profile
            </Button>
            <div className="pt-4 space-y-1">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground px-2 pb-1">Built-in</h4>
              {profiles.filter(p => p.is_builtin).map(p => (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedId === p.id && !isEditingNew ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="pt-4 space-y-1">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground px-2 pb-1">Custom</h4>
              {profiles.filter(p => !p.is_builtin).map(p => (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedId === p.id && !isEditingNew ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card className="col-span-8 h-full flex flex-col">
        {(!selectedId && !isEditingNew) ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a profile to view or edit
          </div>
        ) : (
          <>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5 flex-1 mr-4">
                <CardTitle className="flex items-center gap-2">
                  <Input 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    disabled={isBuiltin}
                    className="text-lg font-semibold h-10 w-full" 
                  />
                  {isBuiltin && <Badge variant="secondary">Built-in</Badge>}
                  {isEditingNew && <Badge variant="default">New</Badge>}
                </CardTitle>
                <CardDescription>
                  {isBuiltin ? "Built-in profiles cannot be modified. Duplicate it to make changes." : "Configure the sequence of build steps."}
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleDuplicate}>
                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4">
              <div className="space-y-3">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex gap-3 p-3 border rounded-lg bg-card items-start">
                    <div className="flex flex-col gap-1 mt-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={isBuiltin || idx === 0} onClick={() => moveStep(idx, 'up')}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={isBuiltin || idx === steps.length - 1} onClick={() => moveStep(idx, 'down')}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex gap-3">
                        <div className="w-1/3">
                          <label className="text-xs font-medium text-muted-foreground">Label</label>
                          <Input 
                            value={step.label} 
                            onChange={e => updateStep(idx, 'label', e.target.value)} 
                            disabled={isBuiltin}
                            className="mt-1 h-8 text-sm" 
                            placeholder="e.g. Build app"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-medium text-muted-foreground">Command (run on server)</label>
                          <Input 
                            value={step.command} 
                            onChange={e => updateStep(idx, 'command', e.target.value)} 
                            disabled={isBuiltin}
                            className="mt-1 h-8 text-sm font-mono" 
                            placeholder="e.g. npm run build"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          id={`continue-${idx}`} 
                          checked={step.continue_on_error}
                          onChange={e => updateStep(idx, 'continue_on_error', e.target.checked)}
                          disabled={isBuiltin}
                          className="rounded border-gray-300"
                        />
                        <label htmlFor={`continue-${idx}`} className="text-xs text-muted-foreground">
                          Continue pipeline if this step fails (non-zero exit code)
                        </label>
                      </div>
                    </div>
                    {!isBuiltin && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeStep(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              
              {!isBuiltin && (
                <Button variant="outline" className="w-full border-dashed" onClick={addStep}>
                  <Plus className="mr-2 h-4 w-4" /> Add Step
                </Button>
              )}
            </CardContent>
            
            {!isBuiltin && (
              <CardFooter className="border-t pt-4 flex justify-between">
                <Button 
                  variant="destructive" 
                  onClick={handleDelete} 
                  disabled={isEditingNew}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Profile
                </Button>
                <Button onClick={handleSave}>
                  <Save className="mr-2 h-4 w-4" /> Save Profile
                </Button>
              </CardFooter>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

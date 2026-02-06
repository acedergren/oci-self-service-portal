export type WorkflowStepStatus = 'pending' | 'planning' | 'running' | 'completed' | 'error' | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  toolName?: string;
  status: WorkflowStepStatus;
  result?: string;
  duration?: number;
  dependencies?: string[]; // IDs of steps this depends on
}

export interface AgentPlan {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: 'idle' | 'planning' | 'executing' | 'completed' | 'error';
  startedAt?: number;
  completedAt?: number;
}

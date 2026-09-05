import {createContext, useContext} from 'react';
import {api} from '../../services/api';
export const WorkspaceContext = createContext({api, accountId: '', mailMode: 'send', provider: 'google' as 'google' | 'microsoft'});
export const useWorkspace = () => useContext(WorkspaceContext);

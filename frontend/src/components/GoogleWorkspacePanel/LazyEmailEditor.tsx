import {forwardRef, lazy, Suspense} from 'react';
import type {EmailEditorHandle, EmailEditorProps} from './EmailEditor';

const EmailEditor = lazy(() => import('./EmailEditor'));

const LazyEmailEditor = forwardRef<EmailEditorHandle, EmailEditorProps>((props, ref) => (
    <Suspense fallback={null}>
        <EmailEditor {...props} ref={ref}/>
    </Suspense>
));

LazyEmailEditor.displayName = 'LazyEmailEditor';

export type {EmailEditorHandle};
export default LazyEmailEditor;

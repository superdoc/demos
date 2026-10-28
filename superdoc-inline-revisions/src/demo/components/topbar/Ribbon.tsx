import { TrackedChangesControls } from '../../../components/TrackedChangesControls';
import { WordToolbar } from '../../../components/WordToolbar/WordToolbar';
import { StyleGallery } from './StyleGallery';

export function Ribbon() {
  return (
    <div className="ribbon-controls-row">
      <WordToolbar />
      <StyleGallery />
      <TrackedChangesControls />
    </div>
  );
}

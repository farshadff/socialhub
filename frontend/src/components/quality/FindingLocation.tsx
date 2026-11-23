import { Link } from '@umijs/max';
import React from 'react';

const FindingLocation: React.FC<{
  itemId: number;
  location?: Record<string, string | number> | null;
}> = ({ itemId, location }) => {
  if (!location) return null;
  if (typeof location.field === 'string') {
    const label = location.field === 'caption' ? 'Caption' : String(location.field).replaceAll('_', ' ');
    return <Link to={`/content/${itemId}?tab=production&focus=${location.field}`}>{label}</Link>;
  }
  if (typeof location.frame_index === 'number') {
    const frame = Number(location.frame_index);
    return <Link to={`/content/${itemId}?tab=production&focus=frame-${frame}`}>Frame {frame}</Link>;
  }
  if (typeof location.asset_id === 'number') {
    const id = Number(location.asset_id);
    return <Link to={`/library?asset=${id}`}>Asset {id}</Link>;
  }
  return null;
};

export default FindingLocation;

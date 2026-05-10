import React from 'react';

const RoleHeader = ({ role }) => {
  let text = '';
  let icon = '';
  let bgColor = '';
  let textColor = '';
  let borderColor = '';

  switch(role.toLowerCase()) {
    case 'tourist':
      icon = '🌍';
      text = 'Tourist Portal';
      bgColor = 'bg-teal-900/40';
      textColor = 'text-teal-300';
      borderColor = 'border-teal-500/30';
      break;
    case 'guide':
      icon = '🧭';
      text = 'Guide Portal';
      bgColor = 'bg-indigo-900/40';
      textColor = 'text-indigo-300';
      borderColor = 'border-indigo-500/30';
      break;
    case 'parent':
    case 'guardian':
      icon = '👨‍👩‍👧';
      text = 'Parent Portal';
      bgColor = 'bg-emerald-900/40';
      textColor = 'text-emerald-300';
      borderColor = 'border-emerald-500/30';
      break;
    default:
      icon = '🌍';
      text = `${role} Portal`;
      bgColor = 'bg-slate-900/40';
      textColor = 'text-slate-300';
      borderColor = 'border-white/10';
  }

  return (
    <div className="w-full flex justify-center mb-6 z-10 relative">
      <div className={`inline-flex items-center gap-2 px-5 py-2 rounded-full border shadow-lg backdrop-blur-xl font-extrabold tracking-wide text-sm ${bgColor} ${textColor} ${borderColor}`}>
        <span className="text-lg">{icon}</span>
        <span>{text}</span>
      </div>
    </div>
  );
};

export default RoleHeader;

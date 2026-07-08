import React from 'react';

const AISuggestions = ({ onSuggestionClick, data }) => {
  const jsonString = data?.[0] || 'a';
  let suggestions = [];
  try {
      const parsedData = data?.length > 0 && jsonString !== 'a' ? JSON.parse(jsonString) : {};
      suggestions = parsedData?.suggested_questions || [];
  } catch (e) {
      console.error("Failed to parse suggestions", e);
  }

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 pt-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {suggestions.slice(0, 3).map((item, index) => (
          <div 
            key={index}
            onClick={() => onSuggestionClick(item)} 
            className="p-3 bg-white rounded-xl cursor-pointer hover:border-brand-purple hover:bg-brand-purple/5 transition-all text-sm text-gray-600 border border-gray-200 shadow-sm"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};
export default AISuggestions;

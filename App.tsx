
import React from 'react';
import { ChatbotText } from './components/ChatbotText';

const App: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-transparent font-sans p-4">
      <ChatbotText />
    </div>
  );
};

export default App;

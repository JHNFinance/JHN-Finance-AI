
import React from 'react';
import { Chatbot } from './components/Chatbot';

const App: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-transparent font-sans p-4">
      <Chatbot />
    </div>
  );
};

export default App;

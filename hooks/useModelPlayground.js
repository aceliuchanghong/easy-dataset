'use client';

import { useState, useEffect } from 'react';

export default function useModelPlayground(projectId) {
  // 状态管理
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [loading, setLoading] = useState({});
  const [userInput, setUserInput] = useState('');
  const [conversations, setConversations] = useState({});
  const [error, setError] = useState(null);
  const [outputMode, setOutputMode] = useState('normal'); // 'normal' 或 'streaming'
  const [uploadedImage, setUploadedImage] = useState(null); // 存储上传的图片Base64

  // 获取项目的模型配置
  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch(`/api/projects/${projectId}/models`);
        if (!response.ok) {
          throw new Error('获取模型列表失败');
        }
        const models = await response.json();
        setAvailableModels(models);
      } catch (error) {
        console.error('获取模型失败:', error);
        setError('无法加载模型，请检查设置');
      }
    }

    if (projectId) {
      fetchModels();
    }
  }, [projectId]);

  // 初始化会话状态
  useEffect(() => {
    if (selectedModels.length > 0) {
      const initialConversations = {};
      selectedModels.forEach(modelId => {
        if (!conversations[modelId]) {
          initialConversations[modelId] = [];
        }
      });

      if (Object.keys(initialConversations).length > 0) {
        setConversations(prev => ({
          ...prev,
          ...initialConversations
        }));
      }
    }
  }, [selectedModels]);

  // 处理模型选择
  const handleModelSelection = event => {
    const {
      target: { value }
    } = event;

    // 限制最多选择 3 个模型
    const selectedValues = typeof value === 'string' ? value.split(',') : value;
    const limitedSelection = selectedValues.slice(0, 3);

    setSelectedModels(limitedSelection);
  };

  // 处理用户输入
  const handleInputChange = e => {
    setUserInput(e.target.value);
  };

  // 处理图片上传
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // 删除已上传的图片
  const handleRemoveImage = () => {
    setUploadedImage(null);
  };

  // 处理输出模式切换
  const handleOutputModeChange = event => {
    setOutputMode(event.target.value);
  };

  // 发送消息给所有选中的模型
  const handleSendMessage = async () => {
    if (!userInput.trim() || Object.values(loading).some(value => value) || selectedModels.length === 0) return;

    // 获取用户输入
    const input = userInput.trim();
    setUserInput('');
    
    // 获取图片（如果有的话）
    const image = uploadedImage;
    setUploadedImage(null); // 清除图片

    // 更新所有选中模型的对话
    const updatedConversations = { ...conversations };
    selectedModels.forEach(modelId => {
      if (!updatedConversations[modelId]) {
        updatedConversations[modelId] = [];
      }
      // 检查是否有图片并且当前模型是视觉模型
      const model = availableModels.find(m => m.id === modelId);
      const isVisionModel = model && model.type === 'vision';
      
      if (isVisionModel && image) {
        // 如果是视觉模型并且有图片，使用复合格式
        updatedConversations[modelId].push({
          role: 'user',
          content: [
            { type: 'text', text: input || '请描述这个图片' },
            { type: 'image_url', image_url: { url: image } }
          ]
        });
      } else {
        // 其他情况使用纯文本
        updatedConversations[modelId].push({
          role: 'user',
          content: input
        });
      }
    });

    setConversations(updatedConversations);

    // 为每个模型设置独立的加载状态
    const updatedLoading = {};
    selectedModels.forEach(modelId => {
      updatedLoading[modelId] = true;
    });
    setLoading(updatedLoading);

    // 为每个模型单独发送请求
    selectedModels.forEach(async modelId => {
      const model = availableModels.find(m => m.id === modelId);
      if (!model) {
        // 模型配置不存在
        const modelConversation = [...(updatedConversations[modelId] || [])];

        // 更新对话状态
        setConversations(prev => ({
          ...prev,
          [modelId]: [...modelConversation, { role: 'error', content: '模型配置不存在' }]
        }));

        // 更新加载状态
        setLoading(prev => ({ ...prev, [modelId]: false }));
        return;
      }

      try {
        // 检查是否是视觉模型且有图片
        const isVisionModel = model.type === 'vision';
        
        // 构建请求消息
        let requestMessages = [...updatedConversations[modelId]]; // 复制当前消息历史
        
        // 如果是vision模型并且有图片，将最后一条用户消息替换为包含图片的消息
        if (isVisionModel && image && requestMessages.length > 0) {
          // 找到最后一条用户消息
          const lastUserMsgIndex = requestMessages.length - 1;
          // 替换为包含图片的消息
          requestMessages[lastUserMsgIndex] = {
            role: 'user',
            content: [
              { type: 'text', text: input || '请描述这个图片' },
              { type: 'image_url', image_url: { url: image } }
            ]
          };
        }
        
        // 根据输出模式选择不同的处理方式
        if (outputMode === 'streaming') {
          // 流式输出处理
          // 先添加一个空的助手回复，用于后续流式更新
          setConversations(prev => {
            const modelConversation = [...(prev[modelId] || [])];
            return {
              ...prev,
              [modelId]: [...modelConversation, { role: 'assistant', content: '', isStreaming: true }]
            };
          });

          const response = await fetch(`/api/projects/${projectId}/playground/chat/stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: requestMessages
            })
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let accumulatedContent = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 解码收到的数据块
            const chunk = decoder.decode(value, { stream: true });
            accumulatedContent += chunk;

            // 更新对话内容
            setConversations(prev => {
              const modelConversation = [...prev[modelId]];
              const lastIndex = modelConversation.length - 1;

              // 更新最后一条消息的内容
              modelConversation[lastIndex] = {
                ...modelConversation[lastIndex],
                content: accumulatedContent
              };

              return {
                ...prev,
                [modelId]: modelConversation
              };
            });
          }

          // 完成流式传输，移除流式标记
          setConversations(prev => {
            const modelConversation = [...prev[modelId]];
            const lastIndex = modelConversation.length - 1;

            // 更新最后一条消息，移除流式标记
            modelConversation[lastIndex] = {
              role: 'assistant',
              content: accumulatedContent,
              isStreaming: false
            };

            return {
              ...prev,
              [modelId]: modelConversation
            };
          });
        } else {
          // 普通输出处理
          const response = await fetch(`/api/projects/${projectId}/playground/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              messages: requestMessages
            })
          });

          // 获取响应数据
          const data = await response.json();

          // 独立更新此模型的对话状态
          setConversations(prev => {
            const modelConversation = [...(prev[modelId] || [])];

            if (response.ok) {
              return {
                ...prev,
                [modelId]: [...modelConversation, { role: 'assistant', content: data.response }]
              };
            } else {
              return {
                ...prev,
                [modelId]: [...modelConversation, { role: 'error', content: `错误: ${data.error || '请求失败'}` }]
              };
            }
          });
        }
      } catch (error) {
        console.error(`请求模型 ${model.name} 失败:`, error);

        // 独立更新此模型的对话状态 - 添加错误消息
        setConversations(prev => {
          const modelConversation = [...(prev[modelId] || [])];
          return {
            ...prev,
            [modelId]: [...modelConversation, { role: 'error', content: `错误: ${error.message}` }]
          };
        });
      } finally {
        // 更新此模型的加载状态
        setLoading(prev => ({ ...prev, [modelId]: false }));
      }
    });
  };

  // 清空所有对话
  const handleClearConversations = () => {
    const clearedConversations = {};
    selectedModels.forEach(modelId => {
      clearedConversations[modelId] = [];
    });
    setConversations(clearedConversations);
    setLoading({});
  };

  // 获取模型名称
  const getModelName = modelId => {
    const model = availableModels.find(m => m.id === modelId);
    return model ? `${model.provider}: ${model.name}` : modelId;
  };

  return {
    availableModels,
    selectedModels,
    loading,
    userInput,
    conversations,
    error,
    outputMode,
    uploadedImage,
    handleModelSelection,
    handleInputChange,
    handleImageUpload,
    handleRemoveImage,
    handleSendMessage,
    handleClearConversations,
    handleOutputModeChange,
    getModelName
  };
}

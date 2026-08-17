package com.courtside.ai.service;

import com.courtside.ai.dto.AiInsightRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

@Service
public class AiInsightService {

  private final LlmClient llmClient;
  private final ObjectMapper objectMapper;

  public AiInsightService(LlmClient llmClient, ObjectMapper objectMapper) {
    this.llmClient = llmClient;
    this.objectMapper = objectMapper;
  }

  public String generateInsight(AiInsightRequest request) {
    String stateJson = toJson(request);
    String question = normalizeQuestion(request.question());

    String prompt = """
        You are Courtside AI, an assistant for a doubles badminton scheduler.
        Analyze the scheduler state and give concise, practical insights.
        Focus on fairness, player rotation, rest balance, close matches, leaderboard implications,
        and one actionable suggestion. Do not invent players or scores.

        User question:
        %s

        Scheduler state JSON:
        %s
        """.formatted(question, stateJson);

    return llmClient.generate(prompt);
  }

  private String normalizeQuestion(String question) {
    if (question == null || question.isBlank()) {
      return "Summarize this badminton session and suggest one improvement.";
    }
    return question.trim();
  }

  private String toJson(AiInsightRequest request) {
    try {
      return objectMapper.writeValueAsString(request.schedulerState());
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("Could not serialize scheduler state.", e);
    }
  }
}
